import { Space } from 'antd'

import { ParentRefetchContext } from '../src/context/ParentRefetchContext'
import type { RefFailure } from '../src/types/Widget'
import Flex from '../src/widgets/Flex/Flex'

/**
 * `?fixture=failed-parts`: a Flex of three slots where snowplow (>= 1.12.75) reported the middle part
 * as failed, once transient (a bare 500: Try again) and once permanent (424 TypeNotInstalled: no
 * retry), as the approved mockup draws them (https://claude.ai/artifact/1yZY3r6QkbzfD78XjdyhTq).
 * The neighbouring slots resolve to refs this harness cannot load, which is fine: failedParts.spec.ts
 * measures only the failed slot.
 */
const TRANSIENT: RefFailure = { code: 500, kind: 'Status', message: 'The type statistics (widgets.templates.krateo.io/v1beta1) could not be looked up.', reason: 'InternalError', status: 'Failure' }
const PERMANENT: RefFailure = {
  code: 424,
  details: { causes: [{ field: 'apiVersion', reason: 'TypeNotInstalled' }], group: 'widgets.templates.krateo.io', kind: 'menus' },
  kind: 'Status',
  message: 'The type menus (widgets.templates.krateo.io/v1beta1) is not installed on this cluster.',
  reason: 'FailedDependency',
  status: 'Failure',
}

const row = (testId: string, failure: RefFailure) => (
  <div data-testid={testId} style={{ width: 640 }}>
    <ParentRefetchContext.Provider value={() => { window.dispatchEvent(new CustomEvent('fixture-retry', { detail: testId })) }}>
      <Flex
        failedRefs={{ middle: failure }}
        resourcesRefs={{ items: [] }}
        uid={`fixture-${testId}`}
        widgetData={{ allowedResources: ['paragraphs'], items: [{ resourceRefId: 'middle' }] }}
      />
    </ParentRefetchContext.Provider>
  </div>
)

export const failedParts = () => (
  <Space orientation='vertical' size='large'>
    {row('transient', TRANSIENT)}
    {row('permanent', PERMANENT)}
  </Space>
)
