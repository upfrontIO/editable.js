import rangy from 'rangy'
import * as nodeType from './node-type'
import * as rangeSaveRestore from './range-save-restore'
import * as parser from './parser'
import * as string from './util/string'
import {createElement} from './util/dom'

function restoreRange (host, range, func) {
  range = rangeSaveRestore.save(range)
  func()
  return rangeSaveRestore.restore(host, range)
}

const zeroWidthSpace = /\u200B/g
const zeroWidthNonBreakingSpace = /\uFEFF/g
const whitespaceExceptSpace = /[^\S ]/g

// Clean up the Html.
export function tidyHtml (element) {
  // if (element.normalize) element.normalize()
  normalizeTags(element)
}

// Remove empty tags and merge consecutive tags (they must have the same
// attributes).
//
// @method normalizeTags
// @param  {HTMLElement} element The element to process.
export function normalizeTags (element) {
  const fragment = document.createDocumentFragment()

  for (const node of element.childNodes) {
    // skip empty tags, so they'll get removed
    if (node.nodeName !== 'BR' && !node.textContent) continue

    if (node.nodeType === nodeType.elementNode && node.nodeName !== 'BR') {
      let sibling = node
      while ((sibling = sibling.nextSibling) !== null) {
        if (!parser.isSameNode(sibling, node)) break

        for (const siblingChild of sibling.childNodes) {
          node.appendChild(siblingChild.cloneNode(true))
        }

        sibling.remove()
      }

      normalizeTags(node)
    }

    fragment.appendChild(node.cloneNode(true))
  }

  while (element.firstChild) element.removeChild(element.firstChild)

  element.appendChild(fragment)
}

export function normalizeWhitespace (text) {
  return text.replace(whitespaceExceptSpace, ' ')
}

// Clean the element from character, tags, etc... added by the plugin logic.
//
// @method cleanInternals
// @param  {HTMLElement} element The element to process.
export function cleanInternals (element) {
  // Uses extract content for simplicity. A custom method
  // that does not clone the element could be faster if needed.
  element.innerHTML = extractContent(element, true)
}

// Extracts the content from a host element.
// Does not touch or change the host. Just returns
// the content and removes elements marked for removal by editable.
//
// @param {DOM node or document fragment} Element where to clean out the innerHTML.
// If you pass a document fragment it will be empty after this call.
// @param {Boolean} Flag whether to keep ui elements like spellchecking highlights.
// @returns {String} The cleaned innerHTML of the passed element or document fragment.
export function extractContent (element, keepUiElements) {
  const innerHtml = (element.nodeType === nodeType.documentFragmentNode
    ? getInnerHtmlOfFragment(element)
    : element.innerHTML
  )
    .replace(zeroWidthNonBreakingSpace, '') // Used for forcing inline elements to have a height
    .replace(zeroWidthSpace, '<br>') // Used for cross-browser newlines

  const clone = document.createElement('div')
  clone.innerHTML = innerHtml
  unwrapInternalNodes(clone, keepUiElements)

  return clone.innerHTML
}

export function getInnerHtmlOfFragment (documentFragment) {
  const div = document.createElement('div')
  div.appendChild(documentFragment)
  return div.innerHTML
}

// Create a document fragment from an html string
// @param {String} e.g. 'some html <span>text</span>.'
export function createFragmentFromString (htmlString) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = htmlString

  const fragment = document.createDocumentFragment()
  while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild)
  return fragment
}

export function adoptElement (node, doc) {
  return node.ownerDocument !== doc
    ? doc.adoptNode(node)
    : node
}

// This is a slight variation of the cloneContents method of a rangyRange.
// It will return a fragment with the cloned contents of the range
// without the commonAncestorElement.
//
// @param {rangyRange}
// @return {DocumentFragment}
export function cloneRangeContents (range) {
  const rangeFragment = range.cloneContents()
  const parent = rangeFragment.childNodes[0]
  const fragment = document.createDocumentFragment()
  while (parent.childNodes.length) fragment.appendChild(parent.childNodes[0])
  return fragment
}

// Remove elements that were inserted for internal or user interface purposes
//
// @param {DOM node}
// @param {Boolean} whether to keep ui elements like spellchecking highlights
// Currently:
// - Saved ranges
export function unwrapInternalNodes (sibling, keepUiElements) {
  while (sibling) {
    const nextSibling = sibling.nextSibling

    if (sibling.nodeType !== nodeType.elementNode) {
      sibling = nextSibling
      continue
    }

    const attr = sibling.getAttribute('data-editable')

    if (sibling.firstChild) unwrapInternalNodes(sibling.firstChild, keepUiElements)

    if (attr === 'remove' || (attr === 'ui-remove' && !keepUiElements)) {
      sibling.remove()
    } if (attr === 'unwrap' || (attr === 'ui-unwrap' && !keepUiElements)) {
      unwrap(sibling)
    }

    sibling = nextSibling
  }
}

// Get all tags that start or end inside the range
export function getTags (host, range, filterFunc) {
  const tags = getInnerTags(range, filterFunc)

  // get all tags that surround the range
  let node = range.commonAncestorContainer
  while (node !== host) {
    if (!filterFunc || filterFunc(node)) tags.push(node)
    node = node.parentNode
  }

  return tags
}

export function getTagsByName (host, range, tagName) {
  return getTags(host, range, (node) => {
    return node.nodeName.toUpperCase() === tagName.toUpperCase()
  })
}

export function getTagsByNameAndAttributes (host, range, elem) {
  return getTags(host, range, (node) => {
    return node.nodeName.toUpperCase() === elem.nodeName.toUpperCase() &&
      areSameAttributes(node.attributes, elem.attributes)
  })
}

export function areSameAttributes (attrs1, attrs2) {
  if (attrs1.length !== attrs2.length) return false

  for (let i = 0; i < attrs1.length; i++) {
    const attr = attrs2[attrs1[i].name]
    if (!(attr && attr.value === attrs1[i].value)) return false
  }

  return true
}

// Get all tags that start or end inside the range
export function getInnerTags (range, filterFunc) {
  return range.getNodes([nodeType.elementNode], filterFunc)
}

// Transform an array of elements into an array
// of tagnames in uppercase
//
// @return example: ['STRONG', 'B']
export function getTagNames (elements = []) {
  return elements.map((element) => element.nodeName)
}

export function isAffectedBy (host, range, tagName) {
  return getTags(host, range)
    .some((elem) => elem.nodeName === tagName.toUpperCase())
}

// select a whole element
export function selectNodeContents (element) {
  const range = rangy.createRange()
  range.selectNodeContents(element)
  return range
}

// Check if the range selects all of the elements contents,
// not less or more.
//
// @param visible: Only compare visible text. That way it does not
//   matter if the user selects an additional whitespace or not.
export function isExactSelection (range, elem, visible) {
  const elemRange = rangy.createRange()
  elemRange.selectNodeContents(elem)

  if (!range.intersectsRange(elemRange)) return false

  let rangeText = range.toString()
  let elemText = (elem.jquery ? elem[0] : elem).textContent

  if (visible) {
    rangeText = string.trim(rangeText)
    elemText = string.trim(elemText)
  }

  return rangeText !== '' && rangeText === elemText
}

export function expandTo (host, range, elem) {
  range.selectNodeContents(elem)
  return range
}

export function toggleTag (host, range, elem) {
  const elems = getTagsByNameAndAttributes(host, range, elem)

  if (elems.length === 1 &&
    isExactSelection(range, elems[0], 'visible')) {
    return removeFormattingElem(host, range, elem)
  }

  return forceWrap(host, range, elem)
}

export function isWrappable (range) {
  return range.canSurroundContents()
}

export function forceWrap (host, range, elem) {
  let restoredRange = restoreRange(host, range, () => {
    nukeElem(host, range, elem)
  })

  // remove all tags if the range is not wrappable
  if (!isWrappable(restoredRange)) {
    restoredRange = restoreRange(host, restoredRange, () => {
      nuke(host, restoredRange)
    })
  }

  wrap(restoredRange, elem)
  return restoredRange
}

export function wrap (range, elem) {
  if (!isWrappable(range)) {
    console.log('content.wrap(): can not surround range')
    return
  }

  if (typeof elem === 'string') elem = createElement(elem)
  range.surroundContents(elem)
}

export function unwrap (elem) {
  elem = elem.jquery ? elem[0] : elem
  const parent = elem.parentNode
  while (elem.firstChild) parent.insertBefore(elem.firstChild, elem)
  parent.removeChild(elem)
}

export function removeFormattingElem (host, range, elem) {
  return restoreRange(host, range, () => {
    nukeElem(host, range, elem)
  })
}

export function removeFormatting (host, range, selector) {
  return restoreRange(host, range, () => {
    nuke(host, range, selector)
  })
}

// Unwrap all tags this range is affected by.
// Can also affect content outside of the range.
export function nuke (host, range, selector) {
  getTags(host, range).forEach((elem) => {
    if (elem.nodeName.toUpperCase() !== 'BR' && (!selector || elem.matches(selector))) {
      unwrap(elem)
    }
  })
}

// Unwrap all tags this range is affected by.
// Can also affect content outside of the range.
export function nukeElem (host, range, node) {
  getTags(host, range).forEach((elem) => {
    if (elem.nodeName.toUpperCase() !== 'BR' && (!node ||
        (elem.nodeName.toUpperCase() === node.nodeName.toUpperCase() &&
          areSameAttributes(elem.attributes, node.attributes)))) {
      unwrap(elem)
    }
  })
}

// Insert a single character (or string) before or after
// the range.
export function insertCharacter (range, character, atStart) {
  const insertEl = document.createTextNode(character)
  const boundaryRange = range.cloneRange()

  boundaryRange.collapse(atStart)
  boundaryRange.insertNode(insertEl)
  range[atStart ? 'setStartBefore' : 'setEndAfter'](insertEl)
  range.normalizeBoundaries()
}

// Surround the range with characters like start and end quotes.
//
// @method surround
export function surround (host, range, startCharacter, endCharacter) {
  insertCharacter(range, endCharacter || startCharacter, false)
  insertCharacter(range, startCharacter, true)
  return range
}

// Removes a character from the text within a range.
//
// @method deleteCharacter
export function deleteCharacter (host, range, character) {
  if (!containsString(range, character)) return range

  range.splitBoundaries()
  const restoredRange = restoreRange(host, range, () => {
    const charRegexp = string.regexp(character)

    range.getNodes([nodeType.textNode], (node) => {
      return node.nodeValue.search(charRegexp) >= 0
    })
      .forEach((node) => {
        node.nodeValue = node.nodeValue.replace(charRegexp, '')
      })
  })

  restoredRange.normalizeBoundaries()
  return restoredRange
}

export function containsString (range, str) {
  return range.toString().indexOf(str) >= 0
}

// Unwrap all tags this range is affected by.
// Can also affect content outside of the range.
export function nukeTag (host, range, tagName) {
  getTags(host, range).forEach((elem) => {
    if (elem.nodeName.toUpperCase() === tagName.toUpperCase()) unwrap(elem)
  })
}
