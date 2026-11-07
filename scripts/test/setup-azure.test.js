const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const setupScript = path.resolve(__dirname, "../setup-azure.sh");

function runSetup(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "secretless-setup-"));
  const logFile = path.join(directory, "commands.jsonl");
  const shim = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const log = process.env.LAB_TEST_LOG;
const entry = { tool, args };
if (args[0] === "ad" && args[1] === "app" && args[2] === "federated-credential") {
  const file = args[args.indexOf("--parameters") + 1];
  entry.credential = JSON.parse(fs.readFileSync(file, "utf8"));
}
fs.appendFileSync(log, JSON.stringify(entry) + "\\n");
if (tool === "sleep") process.exit(0);
if (tool === "gh") {
  if (process.env.LAB_TEST_GH_FAILURE === "true") {
    console.error("HTTP 403: OIDC settings access denied");
    process.exit(1);
  }
  console.log(process.env.LAB_TEST_PREFIX);
} else if (args[0] === "account" && args[1] === "show") {
  console.log(args.includes("tenantId") ? "test-tenant-id" : "test-subscription-id");
} else if (args[0] === "webapp" && args[1] === "show") {
  console.log(args.includes("id") ? "/subscriptions/test/webapps/secretless-test" : "secretless-test.azurewebsites.net");
} else if (args[0] === "ad" && args[1] === "app" && args[2] === "create") {
  console.log("test-client-id");
} else if (args[0] === "ad" && args[1] === "sp" && args[2] === "show") {
  console.log("test-sp-object-id");
} else if (args[0] === "role" && args[1] === "assignment") {
  const attempts = fs.readFileSync(log, "utf8").trim().split("\\n")
    .map(JSON.parse).filter(entry => entry.args[0] === "role").length;
  if (attempts <= Number(process.env.LAB_TEST_ROLE_FAILURES)) {
    console.error("AuthorizationFailed: role assignment unavailable");
    process.exit(1);
  }
} else if (!(
  (args[0] === "group" && args[1] === "create") ||
  (args[0] === "appservice" && args[1] === "plan" && args[2] === "create") ||
  (args[0] === "webapp" && args[1] === "create") ||
  (args[0] === "ad" && args[1] === "sp" && args[2] === "create") ||
  (args[0] === "ad" && args[1] === "app" && args[2] === "federated-credential")
)) {
  console.error("Unexpected command: " + tool + " " + args.join(" "));
  process.exit(1);
}
`;
  try {
    for (const tool of ["az", "gh", "sleep"]) {
      fs.writeFileSync(path.join(directory, tool), shim, { mode: 0o755 });
    }
    const result = spawnSync("bash", [setupScript], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        TMPDIR: directory,
        GITHUB_REPO: "octocat/lab",
        APP_NAME: "secretless-test",
        RG: "rg-secretless-test",
        BRANCH: "main",
        SET_GH_VARS: "false",
        LAB_TEST_LOG: logFile,
        LAB_TEST_PREFIX: options.prefix ?? "repo:octocat@123/lab@456",
        LAB_TEST_GH_FAILURE: String(options.ghFailure ?? false),
        LAB_TEST_ROLE_FAILURES: String(options.roleFailures ?? 0),
      },
    });
    assert.ifError(result.error);
    const commands = fs.readFileSync(logFile, "utf8").trim().split("\n").map(JSON.parse);
    const credentialCommand = commands.find((entry) => entry.credential);
    if (credentialCommand) {
      const args = credentialCommand.args;
      assert.equal(fs.existsSync(args[args.indexOf("--parameters") + 1]), false);
    }
    return { ...result, commands };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("setup registers the immutable repository subject and Web App scoped role", () => {
  const result = runSetup();
  assert.equal(result.status, 0, result.stderr);
  const credential = result.commands.find((entry) => entry.credential).credential;
  assert.equal(credential.subject, "repo:octocat@123/lab@456:ref:refs/heads/main");
  const role = result.commands.find((entry) => entry.args[0] === "role").args;
  assert.equal(role[role.indexOf("--role") + 1], "Website Contributor");
  assert.equal(role[role.indexOf("--scope") + 1], "/subscriptions/test/webapps/secretless-test");
});

test("setup falls back to the legacy repository subject when the prefix is absent", () => {
  for (const prefix of ["", "null"]) {
    const result = runSetup({ prefix });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.commands.find((entry) => entry.credential).credential.subject,
      "repo:octocat/lab:ref:refs/heads/main"
    );
  }
});

test("setup stops before provisioning when the OIDC settings lookup fails", () => {
  const result = runSetup({ ghFailure: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTTP 403/);
  assert.equal(result.commands.some((entry) => entry.tool === "az"), false);
  assert.doesNotMatch(result.stdout, /5\/5 Done/);
});

test("setup reports failure when every role assignment attempt fails", () => {
  const result = runSetup({ roleFailures: 5 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AuthorizationFailed/);
  assert.equal(result.commands.filter((entry) => entry.args[0] === "role").length, 5);
  assert.doesNotMatch(result.stdout, /5\/5 Done/);
});

test("setup succeeds after a transient role assignment failure", () => {
  const result = runSetup({ roleFailures: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.commands.filter((entry) => entry.args[0] === "role").length, 2);
  assert.match(result.stdout, /5\/5 Done/);
});
