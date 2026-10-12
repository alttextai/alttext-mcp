# AltText.ai CLI

`alttext` runs every AltText.ai operation from a terminal or a script: generating and managing alt text, account settings, page scraping, and, with a full-access key, managing the account's site API keys.

## Install

```sh
npm install -g @alttext_ai/cli
```

Requires Node.js 22 or later.

## Log in

```sh
alttext login
```

`login` asks for your API key without echoing it, checks it with the API, and stores it only if the check passes. To log in from a script, pipe the key on stdin:

```sh
alttext login < key.txt
```

The key goes into the OS keychain. When no keychain is available, it goes into `$XDG_CONFIG_HOME/alttext/credentials` (default `~/.config/alttext/credentials`), readable only by you. There is no flag for passing a key on the command line, since command lines end up in shell history and process lists.

`ALTTEXT_API_KEY` overrides the stored key for any command, which suits CI. `alttext logout` removes the stored key from both places.

```sh
alttext whoami
```

`whoami` shows the account, the key's kind (`site` or `full_access`), whether it can manage keys, and where the key came from: the environment, the keychain, or the credentials file.

## Commands

```text
alttext login | logout | whoami
alttext account get | update
alttext images generate | generate-from-file | translate | list | search | get | update | delete | bulk-create
alttext pages scrape
alttext keys list | get | reveal | create | update | rotate | revoke | history
```

Run `alttext <command> --help` for each command's flags. Commands that take one key or image take its ID as an argument, for example `alttext keys get 42` or `alttext images delete my-asset-id`.

The `keys` commands need a full-access key. A site key gets exit code 4.

## Global flags

| Flag                      | Effect                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--json`                  | Print the result as JSON on stdout, in the same shape the MCP tool returns                                        |
| `--no-input`              | Never prompt; fail instead                                                                                        |
| `--yes`                   | Run a destructive command without asking                                                                          |
| `--dry-run`               | Read the target and print what a change would do, without changing anything                                       |
| `--show-tokens`           | Show full tokens in `keys list` and `keys get`                                                                    |
| `--idempotency-key <key>` | For key changes: reuse the same value when retrying. One is generated and printed to stderr when you leave it out |

Results go to stdout. Errors, warnings and notes go to stderr. Color is used only on a terminal and never when `NO_COLOR` is set.

## Keys and tokens

`keys list` and `keys get` show the last four characters of each token unless you pass `--show-tokens`. `keys create`, `keys rotate` and `keys reveal` print the token alone on stdout, so it can be captured directly:

```sh
TOKEN=$(alttext keys create --name "Acme Bakery" --usage-limit 500)
```

`keys list` shows one page; a note on stderr says when more exist. `--all` follows the cursors to the end. Filter with `--status active|revoked|all` and `--q <name>`.

`keys rotate`, `keys revoke`, `images delete` and `account update` ask before running. The prompt names the key, says that the old token stops working immediately or that revocation can't be undone, and names the integration when the key belongs to Shopify, BigCommerce or WordPress Connect. Without a terminal, or with `--no-input`, these commands need `--yes` and otherwise exit 2 without sending anything.

## Examples

Onboard a reseller's new client with its own key and a monthly limit:

```sh
TOKEN=$(alttext keys create --name "Acme Bakery" --usage-limit 500)
# install $TOKEN in the client's WordPress plugin
alttext keys list --q "Acme"
```

Respond to a leaked token:

```sh
alttext keys list --q "Acme"              # find the key's ID
alttext keys rotate 42 --dry-run          # check which key this is
NEW_TOKEN=$(alttext keys rotate 42 --yes) # the old token stops working now
# install $NEW_TOKEN where the old one was
alttext keys history 42                   # see who changed the key and when
```

Bill a month from a script:

```sh
alttext keys list --status all --all --json | jq '.api_keys[] | {name, billable_credits}'
```

Change a client's limit, or remove it:

```sh
alttext keys update 42 --usage-limit 1000
alttext keys update 42 --usage-limit none
```

## Exit codes

| Code | Meaning                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Success                                                                                                                                                       |
| 1    | Any other failure                                                                                                                                             |
| 2    | Usage error, including a destructive command run without a terminal and without `--yes`                                                                       |
| 3    | Authentication: no key, an invalid key (`invalid_api_key`) or a revoked key (`api_key_revoked`)                                                               |
| 4    | Permission: the key can't do this (`full_access_required`, `insufficient_scope`)                                                                              |
| 5    | Not found                                                                                                                                                     |
| 6    | Conflict: the key is revoked (`key_revoked`), or an idempotency key clashes (`idempotent_replay_superseded`, `request_in_progress`, `idempotency_key_reused`) |
| 7    | Rate limited; the error says how long to wait                                                                                                                 |

## Development

`ALTTEXT_API_BASE_URL` points the CLI at another API, such as `http://localhost:3000/api/v1`. Requests identify themselves with `X-Client: alttext-cli/<version>`.
