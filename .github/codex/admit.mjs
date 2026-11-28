import { appendFile, lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const repository = 'aleksandrsemenenko2018-max/SBUILD--CONTROL-DEMO';
const owner = repository.split('/')[0];
const workflow = 'codex-issue-dispatch.yml';
const dailyLimit = 3;
const dayMilliseconds = 24 * 60 * 60 * 1000;

export async function admit(env, fetchApi, now = Date.now()) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_REF !== 'refs/heads/work' ||
      env.GITHUB_ACTOR !== owner ||
      env.GITHUB_TRIGGERING_ACTOR !== owner ||
      env.GITHUB_RUN_ATTEMPT !== '1') {
    throw new Error('Dispatch must be a first manual run from the repository owner on work.');
  }
  if (!/^[1-9][0-9]{0,9}$/.test(env.ISSUE_NUMBER ?? '')) {
    throw new Error('Supply a positive GitHub issue number.');
  }
  const issue = await fetchApi(`issues/${env.ISSUE_NUMBER}`);
  if (issue.number !== Number(env.ISSUE_NUMBER) || issue.state !== 'open' ||
      issue.pull_request || !Array.isArray(issue.labels) ||
      !issue.labels.some(label => label.name === 'codex-approved')) {
    throw new Error('The GitHub issue must be open and carry the codex-approved label.');
  }
  const created = encodeURIComponent(`>=${new Date(now - dayMilliseconds).toISOString()}`);
  const history = await fetchApi(`actions/workflows/${workflow}/runs?event=workflow_dispatch&created=${created}&per_page=${dailyLimit + 1}`);
  if (!Number.isInteger(history.total_count) || history.total_count < 1 ||
      !Array.isArray(history.workflow_runs) ||
      !history.workflow_runs.some(run => String(run.id) === env.GITHUB_RUN_ID)) {
    throw new Error('Dispatch count could not be verified.');
  }
  if (history.total_count > dailyLimit) {
    throw new Error('Rolling 24-hour dispatch limit reached.');
  }
  return `.github/codex/tasks/${env.ISSUE_NUMBER}.md`;
}

async function run() {
  const { GITHUB_TOKEN, GITHUB_OUTPUT } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OUTPUT) throw new Error('GitHub runner context is required.');
  const fetchApi = async endpoint => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`GitHub admission check returned HTTP ${response.status}.`);
    return response.json();
  };
  const taskPath = await admit(process.env, fetchApi);
  if (!(await lstat(taskPath)).isFile()) throw new Error('A reviewed task file is required.');
  await appendFile(GITHUB_OUTPUT, `task_path=${taskPath}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
