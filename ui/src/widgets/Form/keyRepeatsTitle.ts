/**
 * Whether a field's title only spells its schema key, so showing the key beside it adds nothing
 * ("Instance name" over `instanceName`, "Image tag" over `image.tag`, "API URL" over `apiURL`).
 *
 * The two are compared as their letters and digits alone, lowercased, with every case change,
 * `_`, `-`, `.` and space dropped. That is the same as comparing the word sequences (a sequence
 * of words is equal exactly when the joined strings are, for any split of them), and it needs no
 * rule for acronyms: `tlsCAFile`, `IPv6Enabled` and `apiURL` need not be split the way a person
 * would say them, to match "TLS CA file", "IPv6 enabled" and "API URL". "Hostname" over
 * `hostName`, and "host name" over `hostname`, match for the same reason.
 *
 * A title with a different word keeps the key, even when it is a near one: "Replicas" over
 * `replicaCount`, "Storage class" over `storageClassName` (it says less than the key), "Enable"
 * over `enabled`. The key is then the name a chart author and values.yaml use.
 */
const squash = (text: string): string => text.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()

export const keyRepeatsTitle = (key: string, label: string): boolean => squash(key) === squash(label)
