/**
 * What a builder's address (isBuilderPath) shows when the Builders could NOT be read from the cluster.
 *
 * A builder's route only exists once its Builder CR is read (clusterBuilders.ts), so after a failed
 * read /portal-builder/compose and its siblings are addresses nothing serves. A bare 404 there would
 * blame the address for a broken cluster source; this says what actually failed, with the reason the
 * read gave. There is no bundled fallback to mount instead (ADR 0001).
 */
import { Result } from 'antd'

export const BUILDERS_UNAVAILABLE_TITLE = 'Builders could not be read from the cluster'

const BuildersUnavailable = ({ reason }: { reason: string }) => (
  <Result
    status='warning'
    subTitle={(
      <>
        <p>{`${BUILDERS_UNAVAILABLE_TITLE}: ${reason}`}</p>
        <p>This builder&apos;s page opens once they can be read.</p>
      </>
    )}
    title={BUILDERS_UNAVAILABLE_TITLE}
  />
)

export default BuildersUnavailable
