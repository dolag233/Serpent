# Hook Blocking Probe

Fixed Phase D fixture. Declares `hook.blocking` and registers an `asset.trash`
onWill handler that returns `{ action: 'block', code: 'DEMO_BLOCK' }`.
