import { describe, expect, it } from 'vitest'

import { keyRepeatsTitle } from './keyRepeatsTitle'

// [key, title, the key repeats the title (so it is hidden)]
const cases: Array<[string, string, boolean]> = [
  ['instanceName', 'Instance name', true],
  ['name', 'Name', true],
  ['name', 'name', true],
  ['hostName', 'Hostname', true],
  ['hostname', 'Host name', true],
  ['host_name', 'Host name', true],
  ['host-name', 'Host name', true],
  ['image.tag', 'Image tag', true],
  ['serviceType', 'Service type', true],
  ['apiURL', 'API URL', true],
  ['tlsCAFile', 'TLS CA file', true],
  ['IPv6Enabled', 'IPv6 enabled', true],
  ['port2', 'Port 2', true],
  // a different word: the key is the name values.yaml uses, so it stays
  ['replicaCount', 'Replicas', false],
  ['storageClassName', 'Storage class', false],
  // decision: "Enable" is not `enabled`; a different word keeps the key
  ['enabled', 'Enable', false],
  ['azs', 'Availability zones', false],
]

describe('keyRepeatsTitle', () => {
  it.each(cases)('%s over "%s" repeats: %s', (key, label, repeats) => {
    expect(keyRepeatsTitle(key, label)).toBe(repeats)
  })
})
