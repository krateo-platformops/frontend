/**
 * The three Builder CRs this repository authors, parsed — FOR TESTS ONLY.
 *
 * The product reads Builders from the cluster (clusterBuilders.ts) and never imports this module:
 * the YAML beside it is the source the portal chart's CRs are copied from, and test data. The suite's
 * setup (src/test/setup.ts) installs these into the registry so engine and composer tests run against
 * the shipped Builders with no network; a test of the cluster read itself stubs the fetch instead.
 */
import { load } from 'js-yaml'

import { parseBuilderItems, type Loaded } from '../builderRegistry'

import blueprintBuilderYaml from './blueprint-builder.builder.yaml?raw'
import controllerBuilderYaml from './controller-builder.builder.yaml?raw'
import portalBuilderYaml from './portal-builder.builder.yaml?raw'

/** The fixture files, by name, as raw text — what the portal chart ships byte for byte. */
export const FIXTURE_TEXTS: Readonly<Record<string, string>> = {
  'blueprint-builder.builder.yaml': blueprintBuilderYaml,
  'controller-builder.builder.yaml': controllerBuilderYaml,
  'portal-builder.builder.yaml': portalBuilderYaml,
}

/** The fixtures as the CR objects a cluster list returns, in the order the registry has always held them. */
export const fixtureItems = (): unknown[] =>
  [portalBuilderYaml, blueprintBuilderYaml, controllerBuilderYaml].map((text) => load(text))

/** The fixtures, parsed exactly as a cluster read is. */
export const fixtureBuilders = (): Loaded => parseBuilderItems(fixtureItems())
