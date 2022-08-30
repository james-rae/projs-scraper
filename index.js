// run 'npm start' to start the app up
let accessToken = "";
let urlInput = "";
let customFields = [];

const x = Math.floor(Math.random() * 3) + 1;
const img = `images/NH_${x}.png`;

document.getElementById("ACNH-img").src = img;
document.getElementById("ACNH-img").style.display = "block";

document.getElementById("url-input").value = getProjectURL("project-url");
document.getElementById("query-btn").onclick = () => {
  query();
};
document.getElementById("export-btn").onclick = () => {
  exportToCSV();
};

/**
 * Runs a GraphQL query for a GitHub Project (new)
 * @param {string} org
 * @param {int} projNum
 * @param {string} cursor
 * @returns JSON response
 */
async function requestProject(org, projNum, cursor) {
  const data = JSON.stringify({
    /**
     * Notes on the query:
     *    - for now, we are covering Issue and DraftIssue types (not PullRequest)
     *    - gets all items (rows) in the project
     *    - getting the first 10 assignees, first 100 labels, first 100 fieldValues
     *      - assuming there won't be more than this. otherwise will get complicated with pagination
     */
    query: `query ($org: String!, $projNum: Int!, $cursor: String) {
              organization(login: $org) {
                name
                projectNext(number: $projNum) {
                  title
                  url
                  items (first: 100, after: $cursor) {
                    totalCount
                    nodes {
                      content {
                        ... on Issue {
                          title
                          number
                          state
                          assignees(first: 10) {
                            nodes {
                              name
                            }
                          }
                          labels(first: 100) {
                            nodes {
                              name
                            }
                          }
                        }
                        ... on DraftIssue {
                          title
                          assignees(first: 10) {
                            nodes {
                              name
                            }
                          }
                        }
                      }
                      fieldValues(first: 100) {
                        nodes {
                          projectField {
                            name
                            settings
                          }
                          value
                        }
                      }
                    }
                    pageInfo {
                      endCursor
                      hasNextPage
                    }
                  }
                }
              }
            }`,
    variables: {
      org: org,
      projNum: projNum,
      cursor: cursor,
    },
  });

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": data.length,
      Authorization: `bearer ${accessToken}`,
    },
    body: data,
  }).then(async (response) => {
    if (response.status >= 200 && response.status <= 299) {
      const body = await response.text();
      return body;
    } else {
      reportError(
        `Something went wrong while trying to query ${urlInput}. See console for details.`,
        `Something went wrong while trying to query ${urlInput}: ${response.statusText}`
      );
      return "";
    }
  });

  return response;
}

async function requestProjectFields(org, projNum) {
  const data = JSON.stringify({
    query: `query ($org: String!, $projNum: Int!) {
              organization(login: $org) {
                name
                projectNext(number: $projNum) {
                  title
                  url
                  fields(first: 100) {
                    nodes {
                      dataType
                      name
                      settings
                    }
                  }
                }
              }
            }`,
    variables: {
      org: org,
      projNum: projNum,
    },
  });
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": data.length,
      Authorization: `bearer ${accessToken}`,
    },
    body: data,
  }).then(async (response) => {
    if (response.status >= 200 && response.status <= 299) {
      const body = await response.text();
      return body;
    } else {
      reportError(
        `Something went wrong while trying to query ${urlInput}. See console for details.`,
        `Something went wrong while trying to query ${urlInput}: ${response.statusText}`
      );

      return "";
    }
  });

  return response;
}

/**
 * Build a simple JSON using query results
 * @param {Array<any>} items
 * @returns a simple JSON
 */
function buildResult(items, fields) {
  /**
   * options to support in the future:
   *    - include only open issues
   *    - include issues with a certain label/assignee/status etc.
   *    - filter what data to output (e.g., only assignees and labels)
   */
  const issues = [];
  items.forEach((element) => {
    const customFields = fields.slice();
    const content = element.content;
    const item = {};
    // title
    item.Title = content.title.replace(",", "");
    // issue number
    item.IssueNumber = content.number ? content.number : "";
    // state (OPEN/CLOSED)
    item.State = content.state ? content.state : "";
    // milestone
    // BLAH no milestone for now
    // if (content.milestone) {
    //   item.milestone = content.milestone;
    // }
    // assignees
    item.Assignees = [];
    content.assignees.nodes.forEach((a) => {
      item.Assignees.push(a.name);
    });
    // labels
    item.Labels = [];
    if (content.labels) {
      content.labels.nodes.forEach((l) => {
        item.Labels.push(l.name);
      });
    }
    // other fields
    const allFields = element.fieldValues.nodes;
    customFields.forEach((f) => {
      const fieldItem = allFields.find((item) => {
        return item.projectField.name == f;
      });
      if (fieldItem) {
        const projField = fieldItem.projectField;
        if (projField.settings == "null") {
          item[projField.name] = fieldItem.value;
        } else {
          const options = JSON.parse(projField.settings);
          if (options.options) {
            item[projField.name] = options.options.find((opt) => {
              return opt.id == fieldItem.value;
            }).name_html;
          }
        }
      } else {
        item[f] = "";
      }
    });

    issues.push(item);
  });
  return issues;
}

/**
 * Query all issues in a GitHub Project (new)
 * @param {string} org
 * @param {int} projNum
 * @returns a simple JSON which includes the full query results
 */
async function getAllIssues(org, projNum, fields) {
  let hasNextPage = false;
  let cursor = "";
  const issues = { items: [] };
  do {
    let body = await requestProject(
      org,
      projNum,
      hasNextPage ? cursor : undefined
    );
    if (!body) {
      return;
    }
    body = JSON.parse(body);
    if (!body.data.organization) {
      reportError(
        "An error occured. See console for details.",
        "An error occured while querying for project information. Check that Project URL is correct."
      );
      return;
    }
    console.log(
      `Querying ${body.data.organization.projectNext.title} in ${org}`
    );
    // build result
    issues.items = issues.items.concat(
      buildResult(body.data.organization.projectNext.items.nodes, fields)
    );
    // check if we need to paginate
    let pageInfo = body.data.organization.projectNext.items.pageInfo;
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  } while (hasNextPage);

  return issues;
}

async function getCustomFields(org, projNum) {
  let result = await requestProjectFields(org, projNum);
  if (!result) {
    return;
  }
  result = JSON.parse(result);
  if (!result.data.organization) {
    reportError(
      "An error occured. See console for details.",
      "An error occured while querying for project information. Check that Project URL is correct."
    );
    return;
  }

  const fields = result.data.organization.projectNext.fields.nodes;
  // fields that are already on ProjectNextItemContent.content (Issue)
  const defaultFields = [
    "Title",
    "Number",
    "State",
    "Assignees",
    "Labels",
    // We currently aren't pulling the following on the query.
    "Linked pull requests",
    "Reviewers",
    "Repository",
    "Milestone",
    "Tracks",
    "Iteration",
  ];
  const customFields = [];
  fields.forEach((f) => {
    if (!defaultFields.includes(f.name)) {
      customFields.push(f.name);
    }
  });
  return customFields;
}

async function query() {
  document.getElementById("spinner").style.display = "block";
  document.getElementById("export-btn").setAttribute("disabled", "");
  urlInput = document.getElementById("url-input").value.trim();
  // check if the input boxes are empty
  if (!urlInput) {
    reportError(
      "Missing GitHub Projects URL :(",
      "Missing GitHub Projects URL"
    );
    return;
  }
  accessToken = document.getElementById("token-input").value.trim();
  if (!accessToken) {
    reportError(
      "Missing GitHub Personal Access Token :(",
      "Missing GitHub Personal Access Token"
    );
    return;
  }
  let url;
  // check if the given url is valid
  try {
    url = new window.URL(urlInput);
  } catch {
    reportError("Malformed URL :(", "Malformed URL");
    return;
  }
  const pathArr = url.pathname.split("/").filter(Boolean);
  const org = pathArr[1];
  const projNum = parseInt(pathArr[3]);
  // might want to do some checks to make sure the above is valid

  setProjectURL(urlInput);
  customFields = await getCustomFields(org, projNum);
  if (!customFields) return;

  const issues = await getAllIssues(org, projNum, customFields);
  if (!issues) return;
  console.log(issues);
  document.getElementById("return-val").innerText = JSON.stringify(
    issues,
    null,
    2
  );
  document.getElementById("spinner").style.display = "none";
  document.getElementById("export-btn").removeAttribute("disabled");
}

/**
 * Export results to a CSV
 */
function exportToCSV() {
  const items = JSON.parse(
    document.getElementById("return-val").innerText
  ).items;

  let csvContent =
    "data:text/csv;charset=utf-8," +
    // The fields being displayed may need to change in the future
    "Title,IssueNumber,State,Assignees,Labels," +
    customFields.join() +
    "\n" +
    items
      .map((item) => {
        let line = "";
        for (const prop in item) {
          if (Array.isArray(item[prop])) {
            line = line.concat(item[prop].join("; "), ",");
          } else {
            line = line.concat(item[prop].toString(), ",");
            // "," will mess up the csv formatting
            line = line.replace(",", "");
            // "#" hides everything behind it for some reason
            line = line.replace("#", "");
          }
        }
        line = line.substring(0, line.length - 1);
        return line;
      })
      .join("\n");
  const encodedUri = encodeURI(csvContent);
  window.open(encodedUri);
}

/**
 * Set the project URL in localstorage
 * @param {string} name
 */
function setProjectURL(name) {
  localStorage.setItem("project-url", name);
}

/**
 * Get the project URL from localstorage
 * @param {string} name
 * @returns the project URL
 */
function getProjectURL(name) {
  return localStorage.getItem("project-url");
}

function reportError(outputText, consoleText) {
  document.getElementById("spinner").style.display = "none";
  document.getElementById("return-val").innerText = outputText;
  console.error(consoleText);
}
