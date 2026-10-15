/*
 * The watcher's GitHub side: the CI lanes' latest verdicts on main, main's
 * head commit (for the site's deploy lag), whether a backend deploy is
 * running (to hold service alerts through its restarts), and starting a
 * diagnosis run.
 *
 * Polled, not pushed: GitHub's own scheduler runs backend-watch's
 * fifteen-minute cron 2–7 hours apart (observed 2026-10-14), so nothing that matters
 * can wait on a GitHub-side schedule. The token is a fine-grained one scoped
 * to this repository (Actions: read and write); see HOSTING.md.
 */

import type { LaneRun, MainHead } from './checks';
import type { Fetch } from './solana';

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
  }
}

export class Github {
  /** The last HTTP status GitHub answered with (null: nothing answered). */
  lastStatus: number | null = null;
  /** `github-authentication-token-expiration`, when GitHub sends it for this token. */
  tokenExpiry: string | null = null;

  constructor(
    private readonly repo: string,
    private readonly token: string | null,
    private readonly fetchImpl: Fetch = fetch
  ) {}

  private async get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'blotto-watch',
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.github.com/repos/${this.repo}${path}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      this.lastStatus = null;
      throw new GithubError(`GitHub ${path}: ${(e as Error).message}`, null);
    }
    this.lastStatus = res.status;
    this.tokenExpiry = res.headers.get('github-authentication-token-expiration') ?? this.tokenExpiry;
    if (!res.ok) throw new GithubError(`GitHub ${path}: HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  }

  /**
   * The newest run of `workflow` on main that ended in success or failure
   * (`timed_out` counts as failure; cancelled and skipped runs decide
   * nothing, as in stop-the-line.yml). Null when there is none yet.
   */
  async latestDecidedRun(workflow: string): Promise<LaneRun | null> {
    const j = await this.get<{
      workflow_runs: { name: string; conclusion: string | null; html_url: string; head_sha: string }[];
    }>(`/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=main&status=completed&per_page=10`);
    for (const r of j.workflow_runs) {
      if (r.conclusion === 'success' || r.conclusion === 'failure' || r.conclusion === 'timed_out') {
        return {
          workflow,
          name: r.name,
          conclusion: r.conclusion === 'success' ? 'success' : 'failure',
          url: r.html_url,
          sha: r.head_sha,
        };
      }
    }
    return null;
  }

  /** True while a deploy-backend run is queued or running. */
  async deployRunning(): Promise<boolean> {
    for (const status of ['in_progress', 'queued']) {
      const j = await this.get<{ total_count: number }>(
        `/actions/workflows/deploy-backend.yml/runs?status=${status}&per_page=1`
      );
      if (j.total_count > 0) return true;
    }
    return false;
  }

  async mainHead(): Promise<MainHead> {
    const j = await this.get<{ sha: string; commit: { committer: { date: string } } }>('/commits/main');
    return { sha: j.sha, committedAtMs: Date.parse(j.commit.committer.date) };
  }

  /**
   * Start `.github/workflows/diagnose.yml`. Only incident keys and the
   * Telegram message id travel in the inputs — the run re-reads everything
   * else itself, and nothing it gathers is printed to the public log.
   */
  async dispatchDiagnosis(incidents: string[], messageId: number): Promise<void> {
    if (!this.token) throw new GithubError('no GitHub token: diagnosis cannot be started', null);
    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://api.github.com/repos/${this.repo}/actions/workflows/diagnose.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'blotto-watch',
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ref: 'main',
            inputs: {
              incidents: incidents.join(','),
              message_id: String(messageId),
            },
          }),
          signal: AbortSignal.timeout(15_000),
        }
      );
    } catch (e) {
      throw new GithubError(`dispatch diagnose: ${(e as Error).message}`, null);
    }
    if (res.status !== 204) throw new GithubError(`dispatch diagnose: HTTP ${res.status}`, res.status);
  }
}
