/**
 * The native table — nine kinds in the mockup's order (04:44-52), each with its kstatus meaning.
 */
import { describe, expect, it } from 'vitest'

import { NATIVE_KINDS, nativeKindOf } from './nativeKinds'

describe('NATIVE_KINDS', () => {
  it('is the mockup\'s nine, in its order, each saying its readiness as the palette shows it', () => {
    expect(NATIVE_KINDS.map((entry) => `${entry.kind} · ${entry.display} · ${entry.label}`)).toEqual([
      'Deployment · apps/v1 · available',
      'StatefulSet · apps/v1 · ready replicas',
      'Service · v1 · has endpoints',
      'ConfigMap · v1 · exists',
      'Secret · v1 · exists',
      'Ingress · networking/v1 · lb address',
      'PersistentVolumeClaim · v1 · bound',
      'Job · batch/v1 · complete',
      'CronJob · batch/v1 · exists',
    ])
  })

  it('carries the REAL apiVersion beside the one it displays — an Ingress is networking.k8s.io/v1', () => {
    expect(nativeKindOf('networking.k8s.io/v1', 'Ingress')).toMatchObject({ display: 'networking/v1', readiness: 'lbAddress' })
  })

  it('tags each with the readiness the gate compiles (S4b)', () => {
    expect(Object.fromEntries(NATIVE_KINDS.map((entry) => [entry.kind, entry.readiness]))).toEqual({
      ConfigMap: 'exists',
      CronJob: 'exists',
      Deployment: 'available',
      Ingress: 'lbAddress',
      Job: 'complete',
      PersistentVolumeClaim: 'bound',
      Secret: 'exists',
      Service: 'endpoints',
      StatefulSet: 'readyReplicas',
    })
  })

  it('knows a kind only at its own apiVersion, and nothing it does not place', () => {
    expect(nativeKindOf('apps/v1', 'Deployment')?.label).toBe('available')
    expect(nativeKindOf('extensions/v1beta1', 'Deployment')).toBeNull()
    expect(nativeKindOf('v1', 'ServiceAccount')).toBeNull()
  })
})
