# Equipment-source collector credential bootstrap

A one-container Argo CD `PreSync` hook (wave 2, after ledgered migrations at
wave 0 and the ordinary API/ingestor bootstrap at wave 1). It installs the SCRAM
verifier of one database login, `verdify_experiment_v2_equipment_source_collector_login`
(duty `verdify_experiment_equipment_source_collector`), and then attests it over a
real TCP session: exact login, sole non-admin duty membership, safe role
attributes, no object ownership or direct relation/sequence ACL, and the exact
function allowlist: `fn_record_equipment_counter_sample` and
`fn_record_equipment_state_source_receipt` required, and the retired
`fn_record_equipment_direct_state_snapshot` tolerated but not required until a
later release revokes and drops it (#1633 release 4, phase 4 drops rule 5).
The ingestor writes `equipment_state` through this login and refuses to start in
production without it.

| Secret | key | purpose |
| --- | --- | --- |
| `verdify-app-secrets` | `VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_USER` / `..._DB_PASSWORD` | the collector login |
| `verdify-app-secrets` | `POSTGRES_PASSWORD`, `VERDIFY_API_RUNTIME_DB_PASSWORD`, `VERDIFY_INGESTOR_RUNTIME_DB_PASSWORD` | owner session, and reuse guards |

The password must be 64 lowercase hexadecimal characters and must not reuse the
owner or either ordinary runtime password. Its successful log line contains no
credential material.

History: until #1649 this hook also installed the five other experiment-v2
logins (lifecycle, component executor, shadow scheduler, randomizer, outcome
freezer), validated two experiment API tokens and ran the direct-launch
bootstrap. Those logins keep the verifiers they hold; they are dropped with the
experiment tables. The component keeps its name so the live hook Job is the same
object.
