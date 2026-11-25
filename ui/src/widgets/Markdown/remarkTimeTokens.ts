import type { Parent, PhrasingContent, Root } from 'mdast'

import { splitTimeTokens } from '../../utils/timeTokens'

/**
 * Time tokens in markdown TEXT (`{ago:<ISO>}`, `{age:…}`, `{moment:…}`, `{date:…}`: utils/timeTokens, the
 * same tokens and the same tokenizer as Paragraph and PageHeader) become a `<time>` element, which the
 * widget renders as a TimeText: the words in the viewer's zone, full date on hover and focus.
 *
 * Only `text` nodes are read, so a token inside `inline code` or a fenced block stays literal: a command or
 * a manifest is never rewritten. A text node without a token is left as it is, so markdown without one
 * renders exactly as before.
 */
const rewrite = (parent: Parent) => {
  const children = parent.children as PhrasingContent[]
  for (let index = 0; index < children.length; index++) {
    const node = children[index]
    if (node.type === 'text') {
      const pieces = splitTimeTokens(node.value)
      if (pieces.length === 1 && typeof pieces[0] === 'string') { continue }
      const replaced = pieces.map((piece): PhrasingContent => (typeof piece === 'string'
        ? { type: 'text', value: piece }
        // A node of its own type: mdast-util-to-hast turns an unknown node carrying `data.hName` into that
        // element, and its properties are the props the widget's `time` renderer reads.
        : { children: [], data: { hName: 'time', hProperties: { dataForm: piece.form, dateTime: piece.value } }, type: 'timeToken' } as unknown as PhrasingContent))
      children.splice(index, 1, ...replaced)
      index += replaced.length - 1
    } else if ('children' in node) {
      rewrite(node)
    }
  }
}

const remarkTimeTokens = () => (tree: Root) => {
  for (const child of tree.children) {
    if ('children' in child) { rewrite(child) }
  }
}

export default remarkTimeTokens
