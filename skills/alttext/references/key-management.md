# Key management workflows

These workflows need a full-access key: `alttext whoami --json` must show `can_manage_keys: true`. Every rule in SKILL.md applies: dry-run and ask before a rotate or revoke, keep tokens out of the conversation, and back off on exit 7.

A reseller gives each end client its own site key. The key's `name` is how you find the client again, so name keys after the client.

## Find a client's key

```sh
alttext keys list --q "Acme" --json
```

Match on `name`. If more than one active key matches, show the person the candidates (ID, name, token hint, created date) and ask which one. Never guess between two keys. Revoked keys are hidden unless you pass `--status revoked` or `--status all`.

## Onboard a client with a monthly limit

"Create a key for client Acme with 500 credits":

1. Check the name isn't taken: `alttext keys list --q "Acme" --json`. If an active key already exists, ask whether they want a second one.
2. Show what will happen: `alttext keys create --name "Acme" --usage-limit 500 --dry-run`. Confirm the name and the limit with the person.
3. Create it and send the token where it goes, not into the conversation:

   ```sh
   (umask 077; alttext keys create --name "Acme" --usage-limit 500 > acme-token.txt)
   ```

   Tell the person the key's ID and name from stderr, and where the token file is. They paste it into the client's plugin or app settings, then delete the file. If the token is going into a secret store, pipe it there instead, for example `alttext keys create --name "Acme" --usage-limit 500 | gh secret set ALTTEXT_API_KEY --repo acme/site`.
4. If the call failed with a timeout, a network error or exit 7, retry with the same `--idempotency-key` value printed on stderr, so the client doesn't end up with two keys.

`--usage-limit` is credits per billing period. Leave it out, or pass `--usage-limit none`, for no limit.

## Change or remove a client's limit

```sh
alttext keys update 42 --usage-limit 1000 --dry-run
alttext keys update 42 --usage-limit 1000
alttext keys update 42 --usage-limit none
```

The dry run shows the old and new limit; tell the person both before you run it. Rename a key with `--name`.

## Monthly billing

"How many credits did Acme use last month?" or "bill my clients for last month":

```sh
alttext keys list --status all --all --json
```

`--status all` includes keys revoked during the month, which still have usage to bill. `--all` follows every page. Each entry in `api_keys` carries:

- `billable_credits`: credits charged through the key in the current period, uncapped, including charges that went past the key's limit.
- `period_start` and `resets_at`: the current period's bounds.
- `previous_period.billable_credits`: credits charged in the last closed period. `previous_period.recorded_at` says when that period closed.
- `previous_period.billable_complete`: `false` means the period was recorded before billable counting existed and may undercount. Tell the person when a figure comes from an incomplete period.

For "last month", use `previous_period.billable_credits`, and say which period it covers from `recorded_at` and the current `period_start`. For older periods, `alttext keys get 42 --detail full --json` adds the key's credit periods.

Report a table of client name, key ID, status and billable credits. The figures are AltText.ai credits; the person sets their own price per credit.

## Respond to a leaked token

"Rotate Acme's key, it leaked":

1. Find the key: `alttext keys list --q "Acme" --json`. Confirm with the person which key it is if more than one matches.
2. Dry-run the rotation: `alttext keys rotate 42 --dry-run --json`. Show the person the key's name, ID and token hint, that the old token stops working immediately, and the integration warning if the key belongs to Shopify, BigCommerce or WordPress Connect (that integration stops working until it reconnects with the new key).
3. After the person says yes, rotate and send the new token to its destination:

   ```sh
   (umask 077; alttext keys rotate 42 --yes > acme-token.txt)
   ```

4. Check who changed or revealed the key: `alttext keys history 42 --json` lists its recorded changes newest first, with who made each.
5. If the client no longer needs a key at all, revoke instead of rotating (below).

Rotating is the right move for a leak because the client keeps the same key ID, name, limit and usage history; only the token changes.

## Offboard a client

```sh
alttext keys revoke 42 --dry-run --json
alttext keys revoke 42 --yes
```

Revocation can't be undone, and the token stops working immediately. Show both to the person, plus any integration warning, before the `--yes` run. The key and its usage stay readable with `--status revoked`, so the client's final month can still be billed.

## Show a client's token on request

Only when the person asks for one specific key's token:

```sh
alttext keys reveal 42
```

The reveal is recorded in the key's history. Prefer writing it to a file the person can read (`(umask 077; alttext keys reveal 42 > acme-token.txt)`) unless they asked to see it in the chat.
