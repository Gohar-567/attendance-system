import { WebClient } from "@slack/web-api";

let _client: WebClient | null = null;

/**
 * Lazily-initialised Slack WebClient using the bot token.
 *
 * @slack/bolt is in package.json (and pulls @slack/web-api as a peer).
 * We don't use Bolt's App/Receiver wrapper because Next.js App Router
 * routes don't map cleanly onto Bolt's Express-style receivers — instead
 * we verify signatures ourselves and use WebClient (Bolt's HTTP client
 * for the Slack Web API) directly for outbound calls.
 */
export function slackClient(): WebClient {
  if (!_client) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
    _client = new WebClient(token);
  }
  return _client;
}
