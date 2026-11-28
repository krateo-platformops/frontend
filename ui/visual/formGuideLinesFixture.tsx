import { Space } from 'antd'

import Form from '../src/widgets/Form/Form'
import { ListView } from '../src/widgets/List/ListView'

/**
 * `?fixture=form-guide-lines`: a schema Form with top-level fields, one titled with a different key
 * (imagePullSecrets) and one whose title is its key up to case (name). A top-level object renders as a
 * section (global); the object inside it (global.mirror) is a nested group.
 * formGuideLines.spec.ts measures the connector rail (invisible at rest, amber on focus, one visible
 * line per nested group) and the key beside a title. UX review round 3, items 22 and 24. Beside it, a
 * Relations `tree` List, which must draw no branch connector.
 */
export const formGuideLines = () => (
  <Space orientation='vertical' size='large' style={{ width: '100%' }}>
    <div data-testid='form'>
      <Form
        resourcesRefs={{ items: [] }}
        uid='fixture-form-guide-lines'
        widget={{} as never}
        widgetData={{
          requiredMark: 'optional',
          stringSchema: JSON.stringify({
            properties: {
              global: { properties: { imageRegistry: { type: 'string' }, mirror: { properties: { host: { type: 'string' } }, title: 'Mirror', type: 'object' } }, title: 'Global values', type: 'object' },
              imagePullSecrets: { title: 'Image pull secrets', type: 'string' },
              name: { title: 'Name', type: 'string' },
            },
            type: 'object',
          }),
          submitPost: { path: '/fixture', responses: [{ result: { status: 'success' }, when: { status: [201] } }] },
        } as never}
      />
    </div>
    <div data-testid='tree' style={{ width: 360 }}>
      <ListView
        itemTemplate={{ primaryText: '{kind}', rowVariant: 'tree', secondaryText: '{state}', subPrimaryText: '{name}' }}
        items={[{ kind: 'ConfigMap', name: 'acme-feedback-oas', state: 'Pending' }, { kind: 'RestDefinition', name: 'acme-feedback-form', state: 'Pending' }]}
        rowKey='name'
      />
    </div>
  </Space>
)
