# Backlog

- **user_progress last-review-wins.** A restored write can overwrite newer SM-2 state from another device. Not fixed because `updated_at` is not comparable across clients: the frozen Flutter app writes local time with no timezone, so its values are off by the local offset (3h for Uruguay). The clean fix is a `reviewed_at timestamptz` column plus a `BEFORE UPDATE` trigger that keeps the row with the later `reviewed_at`. Narrow window: needs an app kill with unsent ratings AND use of another device before the next open.
- Flutter wrote `updated_at` as a local time without timezone on `user_progress` and `user_settings`, so those stored values are shifted. Only matters if we ever compare timestamps across clients.
