import $ from 'jquery'
import rangy from 'rangy'
import * as content from './content'
import highlightText from './highlight-text'
import TextHighlighting from './plugins/highlighting/text-highlighting'

function isInHost (elem, host) {
  if (!elem.closest) elem = elem.parentNode
  return elem.closest('[data-editable]:not([data-word-id])') === host
}

const highlightSupport = {

  highlightText (editableHost, text, highlightId, type) {
    if (this.hasHighlight(editableHost, highlightId)) return

    const blockText = highlightText.extractText(editableHost)

    const marker = `<span class="highlight-${type}"></span>`
    const markerNode = highlightSupport.createMarkerNode(marker, type, this.win)

    const textSearch = new TextHighlighting(markerNode, 'text')
    const matches = textSearch.findMatches(blockText, [text])

    if (matches && matches.length) {
      if (highlightId) matches[0].id = highlightId
      highlightText.highlightMatches(editableHost, matches)
      return matches[0].startIndex
    }
  },

  highlightRange (editableHost, highlightId, startIndex, endIndex, dispatcher, type) {
    if (this.hasHighlight(editableHost, highlightId)) {
      this.removeHighlight(editableHost, highlightId)
    }
    const range = rangy.createRange()
    range.selectCharacters(editableHost, startIndex, endIndex)

    if (!isInHost(range.commonAncestorContainer, editableHost)) {
      return -1
    }

    const marker = highlightSupport.createMarkerNode(
      `<span class="highlight-${type}" data-word-id="${highlightId}"></span>`,
      type,
      this.win
    )
    const fragment = range.extractContents()
    marker.appendChild(fragment)
    range.deleteContents()
    range.insertNode(marker)
    highlightSupport.cleanupStaleMarkerNodes(editableHost, 'comment')
    if (dispatcher) {
      dispatcher.notify('change', editableHost)
    }
    return startIndex
  },

  updateHighlight (editableHost, highlightId, addCssClass, removeCssClass) {
    if (!document.documentElement.classList) return

    $(editableHost).find(`[data-word-id="${highlightId}"]`)
      .each((index, elem) => {
        if (removeCssClass) elem.classList.remove(removeCssClass)
        if (addCssClass) elem.classList.add(addCssClass)
      })
  },

  removeHighlight (editableHost, highlightId, dispatcher) {
    $(editableHost).find(`[data-word-id="${highlightId}"]`)
      .each((index, elem) => {
        content.unwrap(elem)
        if (dispatcher) {
          dispatcher.notify('change', editableHost)
        }
      })
  },

  hasHighlight (editableHost, highlightId) {
    const matches = $(editableHost).find(`[data-word-id="${highlightId}"]`)
    return !!matches.length
  },

  extractHighlightedRanges (editableHost, type) {
    let findMarkersQuery = '[data-word-id]'
    if (type) findMarkersQuery += `[data-highlight="${type}"]`
    const markers = $(editableHost).find(findMarkersQuery)
    if (!markers.length) {
      return
    }
    const groups = {}
    markers.each((_, marker) => {
      const highlightId = $(marker).data('word-id')
      if (!groups[highlightId]) {
        groups[highlightId] = $(editableHost).find(`[data-word-id="${highlightId}"]`)
      }
    })
    const res = {}
    Object.keys(groups).forEach(highlightId => {
      const position = this.extractMarkerNodePosition(editableHost, groups[highlightId])
      if (position) {
        res[highlightId] = position
      }
    })

    return res
  },

  extractMarkerNodePosition (editableHost, markers) {
    const range = rangy.createRange()
    if (markers.length > 1) {
      range.setStartBefore(markers.first()[0])
      range.setEndAfter(markers.last()[0])
    } else {
      range.selectNode(markers[0])
    }
    const textRange = range.toCharacterRange(editableHost)
    return {
      start: textRange.start,
      end: textRange.end,
      text: range.text()
    }
  },

  cleanupStaleMarkerNodes (editableHost, highlightType) {
    editableHost.querySelectorAll(`span[data-highlight="${highlightType}"]`)
      .forEach(node => {
        if (!node.textContent.length) {
          node.parentNode.removeChild(node)
        }
      })
  },

  createMarkerNode (markerMarkup, highlightType, win) {
    let marker = $(markerMarkup)[0]

    if (win) {
      marker = content.adoptElement(marker, win.document)
    }

    marker.setAttribute('data-editable', 'ui-unwrap')
    marker.setAttribute('data-highlight', highlightType)
    return marker
  }

}

export default highlightSupport
