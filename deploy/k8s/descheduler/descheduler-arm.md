# Descheduler: ownership, delivery and pause

The descheduler evicts labelled pods in `verdify-prod` so that they rebalance across nodes. It runs in
enforce mode as CronJob `descheduler` in namespace `verdify-descheduler`, hourly at `15 * * * *`, with exactly
these arguments:

```text
--policy-config-file=/policy-dir/policy.yaml
--descheduling-interval=0
--v=4
```

`/policy-dir` is an emptyDir. The `maintenance-gate` init container reads Lease
`kube-system/k3s-planned-maintenance` and copies `policy.yaml`, or the no-op `skip-policy.yaml` while the Lease
has a holder, from the `descheduler-policy` ConfigMap (mounted at `/policy-src`). A Lease read error fails the
Job before any eviction. The ServiceAccount's `get` on that one Lease comes with the `verdify-descheduler`
ClusterRole and must be live before this source is delivered.

The policy restricts candidates to labelled pods in `verdify-prod`; PodDisruptionBudgets, priority exclusions
and the per-node eviction limit stay in force. The ingestor is never a candidate. Do not relabel product
workloads or force an eviction to prove a change.

## Source and ownership boundary

`deploy/k8s/descheduler` renders nine objects:

| Kind | Name | Namespace |
| --- | --- | --- |
| Namespace | verdify-descheduler | cluster |
| CronJob | descheduler | verdify-descheduler |
| ConfigMap | descheduler-policy | verdify-descheduler |
| ServiceAccount | descheduler | verdify-descheduler |
| Role | descheduler | verdify-descheduler |
| RoleBinding | descheduler | verdify-descheduler |
| NetworkPolicy | egress-deny-management | verdify-descheduler |
| NetworkPolicy | egress-allow-management-descheduler-kube-api | verdify-descheduler |
| NetworkPolicy | default-deny-ingress | verdify-descheduler |

jvallery/estate-platform declares the Application `verdify-descheduler`
(`gitops/applications/local-prod/verdify-descheduler.yaml`), its AppProject
(`gitops/projects/verdify-descheduler.yaml`) and the cluster-scoped ClusterRole and ClusterRoleBinding
`verdify-descheduler`, because a product repository does not grant cluster RBAC. The Application is pinned to
a commit of this repository, has no automatic sync and no resource-deletion finalizer. The AppProject allows
only the kinds above; Secret, Job, Pod and Deployment are outside it. `CreateNamespace=false` stays; the
Namespace manifest carries `Prune=false,Delete=false` and keeps its labels.

Argo CD is the only writer of these objects. Do not use `kubectl apply -k` as a second writer.

## Delivering a change

1. Merge the change here. Render it (`kustomize build deploy/k8s/descheduler`) and require the nine objects
   above.
2. Read the CronJob's suspend flag and its active Jobs, so that you know what state the change lands on.
3. Move `targetRevision` of the Application to the merge commit in jvallery/estate-platform and merge that.
4. Diff the Application, then sync the objects you changed at that revision with pruning off. Do not use
   replace or force, and do not delete and recreate an object. No Job is part of the sync.
5. Read back the changed objects: unchanged UIDs, the expected spec, the Namespace labels intact, and the
   Application `Synced` and `Healthy` at the new revision.
6. Check the next hourly Job: its image and arguments, its log and what it evicted. An empty candidate set is
   valid. Confirm the ingestor still has exactly one controller connection and that no singleton was evicted.

## Pause and inverse

To pause, commit `spec.suspend: true` on the CronJob and deliver it as above. Suspending prevents new Jobs; it
does not stop one that is already running. Resume the same way. If you pause it with kubectl in an emergency,
put the same value in Git before the next sync, or an old `false` in the pinned revision resumes it. Do not
change the enforce arguments as a way to pause.

To hand the objects back without stopping the service, remove the Application and the AppProject from
jvallery/estate-platform, then delete only the Application object **without cascading** (it has no resources
finalizer; check before deleting). The nine objects, running Jobs, the Namespace and the product workloads
stay, and the CronJob keeps its schedule. Never use `kubectl delete -k` for this.
