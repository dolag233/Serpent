# Derived Field Probe

Fixed standard plugin fixture for PLUGIN-023. It registers the `ext-upper`
derived-field provider and returns the uppercase extension for every asset in
the bounded batch. It also registers the PLUGIN-024 `fixed-token` search
provider, which returns two deterministic asset IDs when the structured query
contains `plugin-probe`.
