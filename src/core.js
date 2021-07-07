import $ from 'jquery'
import rangy from 'rangy'
import config from './config'
import error from './util/error'
import * as parser from './parser'
import * as block from './block'
import * as content from './content'
import * as clipboard from './clipboard'
import Dispatcher from './dispatcher'
import Cursor from './cursor'
import highlightSupport from './highlight-support'
import Highlighting from './highlighting'
import createDefaultEvents from './create-default-events'
import browser from 'bowser'
import {textNodesUnder, getTextNodeAndRelativeOffset} from './util/element'
import {binaryCursorSearch} from './util/binary_search'

/**
 * The Core module provides the Editable class that defines the Editable.JS
 * API and is the main entry point for Editable.JS.
 * It also provides the cursor module for cross-browser cursors, and the dom
 * submodule.
 *
 * @module core
 */

/**
 * Constructor for the Editable.JS API that is externally visible.
 *
 * @param {Object} configuration for this editable instance.
 *   window: The window where to attach the editable events.
 *   defaultBehavior: {Boolean} Load default-behavior.js.
 *   mouseMoveSelectionChanges: {Boolean} Whether to get cursor and selection events on mousemove.
 *   browserSpellcheck: {Boolean} Set the spellcheck attribute on editable elements
 *
 * @class Editable
 */
export default class Editable {

  constructor (instanceConfig) {
    const defaultInstanceConfig = {
      window: window,
      defaultBehavior: true,
      mouseMoveSelectionChanges: false,
      browserSpellcheck: true
    }

    this.config = $.extend(defaultInstanceConfig, instanceConfig)
    this.win = this.config.window
    this.editableSelector = `.${config.editableClass}`

    if (!rangy.initialized) {
      rangy.init()
    }

    this.dispatcher = new Dispatcher(this)
    if (this.config.defaultBehavior === true) {
      this.dispatcher.on(createDefaultEvents(this))
    }
  }

  /**
   * @returns the default Editable configs from config.js
   */
  static getGlobalConfig () {
    return config
  }

  /**
  * Set configuration options that affect all editable
  * instances.
  *
  * @param {Object} global configuration options (defaults are defined in config.js)
  *   log: {Boolean}
  *   logErrors: {Boolean}
  *   editableClass: {String} e.g. 'js-editable'
  *   editableDisabledClass: {String} e.g. 'js-editable-disabled'
  *   pastingAttribute: {String} default: e.g. 'data-editable-is-pasting'
  *   boldTag: e.g. '<strong>'
  *   italicTag: e.g. '<em>'
  */
  static globalConfig (globalConfig) {
    $.extend(config, globalConfig)
    clipboard.updateConfig(config)
  }

  /**
   * Adds the Editable.JS API to the given target elements.
   * Opposite of {{#crossLink "Editable/remove"}}{{/crossLink}}.
   * Calls dispatcher.setup to setup all event listeners.
   *
   * @method add
   * @param {HTMLElement|Array(HTMLElement)|String} target A HTMLElement, an
   *    array of HTMLElement or a query selector representing the target where
   *    the API should be added on.
   * @chainable
   */
  add (target) {
    this.enable($(target))
    // todo: check css whitespace settings
    return this
  }

  /**
   * Removes the Editable.JS API from the given target elements.
   * Opposite of {{#crossLink "Editable/add"}}{{/crossLink}}.
   *
   * @method remove
   * @param {HTMLElement|Array(HTMLElement)|String} target A HTMLElement, an
   *    array of HTMLElement or a query selector representing the target where
   *    the API should be removed from.
   * @chainable
   */
  remove (target) {
    const $target = $(target)
    this.disable($target)
    $target.removeClass(config.editableDisabledClass)
    return this
  }

  /**
  * Removes the Editable.JS API from the given target elements.
  * The target elements are marked as disabled.
  *
  * @method disable
  * @param { jQuery element | undefined  } target editable root element(s)
  *    If no param is specified all editables are disabled.
  * @chainable
  */
  disable ($elem) {
    const body = this.win.document.body
    $elem = $elem || $(`.${config.editableClass}`, body)
    $elem.each((i, el) => block.disable(el))

    return this
  }

  /**
  * Adds the Editable.JS API to the given target elements.
  *
  * @method enable
  * @param { jQuery element | undefined } target editable root element(s)
  *    If no param is specified all editables marked as disabled are enabled.
  * @chainable
  */
  enable ($elem, normalize) {
    const body = this.win.document.body
    $elem = $elem || $(`.${config.editableDisabledClass}`, body)

    const shouldSpellcheck = this.config.browserSpellcheck
    $elem.each((i, el) => {
      block.init(el, {normalize, shouldSpellcheck})
      this.dispatcher.notify('init', el)
    })

    return this
  }

  /**
  * Temporarily disable an editable.
  * Can be used to prevent text selction while dragging an element
  * for example.
  *
  * @method suspend
  * @param jQuery object
  */
  suspend ($elem) {
    const body = this.win.document.body
    $elem = $elem || $(`.${config.editableClass}`, body)

    $elem.removeAttr('contenteditable')
    this.dispatcher.suspend()
    return this
  }

  /**
  * Reverse the effects of suspend()
  *
  * @method continue
  * @param jQuery object
  */
  continue ($elem) {
    const body = this.win.document.body
    $elem = $elem || $(`.${config.editableClass}`, body)

    $elem.attr('contenteditable', true)
    this.dispatcher.continue()
    return this
  }
  /**
   * Set the cursor inside of an editable block.
   *
   * @method createCursor
   * @param position 'beginning', 'end', 'before', 'after'
   */

  createCursor (element, position = 'beginning') {
    const host = Cursor.findHost(element, this.editableSelector)
    if (!host) return undefined

    const range = rangy.createRange()

    if (position === 'beginning' || position === 'end') {
      range.selectNodeContents(element)
      range.collapse(position === 'beginning')
    } else if (element !== host) {
      if (position === 'before') {
        range.setStartBefore(element)
        range.setEndBefore(element)
      } else if (position === 'after') {
        range.setStartAfter(element)
        range.setEndAfter(element)
      }
    } else {
      error('EditableJS: cannot create cursor outside of an editable block.')
    }

    return new Cursor(host, range)
  }

  createCursorAtCharacterOffset ({element, offset}) {
    const textNodes = textNodesUnder(element)
    const {node, relativeOffset} = getTextNodeAndRelativeOffset({textNodes, absOffset: offset})
    const newRange = rangy.createRange()
    newRange.setStart(node, relativeOffset)
    newRange.collapse(true)

    const host = Cursor.findHost(element, this.editableSelector)
    const nextCursor = new Cursor(host, newRange)

    nextCursor.setVisibleSelection()
    return nextCursor
  }

  createCursorAtBeginning (element) {
    return this.createCursor(element, 'beginning')
  }

  createCursorAtEnd (element) {
    return this.createCursor(element, 'end')
  }

  createCursorBefore (element) {
    return this.createCursor(element, 'before')
  }

  createCursorAfter (element) {
    return this.createCursor(element, 'after')
  }

  /**
   * Extract the content from an editable host or document fragment.
   * This method will remove all internal elements and ui-elements.
   *
   * @param {DOM node or Document Fragment} The innerHTML of this element or fragment will be extracted.
   * @returns {String} The cleaned innerHTML.
   */
  getContent (element) {
    return content.extractContent(element)
  }

  /**
   * @param {String | DocumentFragment} content to append.
   * @returns {Cursor} A new Cursor object just before the inserted content.
   */
  appendTo (inputElement, contentToAppend) {
    const element = content.adoptElement(inputElement, this.win.document)

    const cursor = this.createCursor(element, 'end')
    // todo: create content in the right window
    cursor.insertAfter(typeof contentToAppend === 'string'
      ? content.createFragmentFromString(contentToAppend)
      : contentToAppend
    )
    return cursor
  }

  /**
   * @param {String | DocumentFragment} content to prepend
   * @returns {Cursor} A new Cursor object just after the inserted content.
   */
  prependTo (inputElement, contentToPrepend) {
    const element = content.adoptElement(inputElement, this.win.document)

    const cursor = this.createCursor(element, 'beginning')
    // todo: create content in the right window
    cursor.insertBefore(typeof contentToPrepend === 'string'
      ? content.createFragmentFromString(contentToPrepend)
      : contentToPrepend
    )
    return cursor
  }

  /**
   * Get the current selection.
   * Only returns something if the selection is within an editable element.
   * If you pass an editable host as param it only returns something if the selection is inside this
   * very editable element.
   *
   * @param {DOMNode} Optional. An editable host where the selection needs to be contained.
   * @returns A Cursor or Selection object or undefined.
   */
  getSelection (editableHost) {
    let selection = this.dispatcher.selectionWatcher.getFreshSelection()
    if (!(editableHost && selection)) return selection

    const range = selection.range
    // Check if the selection is inside the editableHost
    // The try...catch is required if the editableHost was removed from the DOM.
    try {
      if (range.compareNode(editableHost) !== range.NODE_BEFORE_AND_AFTER) {
        selection = undefined
      }
    } catch (e) {
      selection = undefined
    }

    return selection
  }

  /**
   * Enable spellchecking
   *
   * @chainable
   */
  setupHighlighting (hightlightingConfig) {
    this.highlighting = new Highlighting(this, hightlightingConfig)

    return this
  }

  // For backwards compatibility
  setupSpellcheck (conf) {
    let marker

    if (conf.markerNode) {
      marker = conf.markerNode.outerHTML
    }

    this.setupHighlighting({
      throttle: conf.throttle,
      spellcheck: {
        marker: marker,
        spellcheckService: conf.spellcheckService
      }
    })

    this.spellcheck = {
      checkSpelling: (elem) => {
        this.highlighting.highlight(elem)
      }
    }
  }

  /**
   * Highlight text within an editable.
   *
   * By default highlights all occurences of `text`.
   * Pass it a `textRange` object to highlight a
   * specific text portion.
   *
   * The markup used for the highlighting will be removed
   * from the final content.
   *
   *
   * @param  {Object} options
   * @param  {DOMNode} options.editableHost
   * @param  {String} options.text
   * @param  {String} options.highlightId Added to the highlight markups in the property `data-word-id`
   * @param  {Object} [options.textRange] An optional range which gets used to set the markers.
   * @param  {Number} options.textRange.start
   * @param  {Number} options.textRange.end
   * @param  {Boolean} options.raiseEvents do throw change events
   * @return {Number} The text-based start offset of the newly applied highlight or `-1` if the range was considered invalid.
   */
  highlight ({editableHost, text, highlightId, textRange, raiseEvents}) {
    if (!textRange) {
      return highlightSupport.highlightText(editableHost, text, highlightId)
    }
    if (typeof textRange.start !== 'number' || typeof textRange.end !== 'number') {
      error(
        'Error in Editable.highlight: You passed a textRange object with invalid keys. Expected shape: { start: Number, end: Number }'
      )
      return -1
    }
    if (textRange.start === textRange.end) {
      error(
        'Error in Editable.highlight: You passed a textRange object with equal start and end offsets, which is considered a cursor and therefore unfit to create a highlight.'
      )
      return -1
    }
    return highlightSupport.highlightRange(editableHost, highlightId, textRange.start, textRange.end, raiseEvents ? this.dispatcher : undefined)
  }

  /**
   * Extracts positions of all DOMNodes that match `[data-word-id]` and the `[data-highlight]`
   *
   * Returns an object where the keys represent a highlight id and the value
   * a text range object of shape:
   * ```
   * { start: number, end: number, text: string}
   * ```
   *
   * @param  {Object} options
   * @param  {DOMNode} options.editableHost
   * @param  {String} [options.type]
   * @return {Object} ranges
   */
  getHighlightPositions ({editableHost, type}) {
    return highlightSupport.extractHighlightedRanges(
      editableHost,
      type
    )
  }

  removeHighlight ({editableHost, highlightId, raiseEvents}) {
    highlightSupport.removeHighlight(editableHost, highlightId, raiseEvents ? this.dispatcher : undefined)
  }

  decorateHighlight ({editableHost, highlightId, addCssClass, removeCssClass}) {
    highlightSupport.updateHighlight(editableHost, highlightId, addCssClass, removeCssClass)
  }

  /**
   * Subscribe a callback function to a custom event fired by the API.
   *
   * @param {String} event The name of the event.
   * @param {Function} handler The callback to execute in response to the
   *     event.
   *
   * @chainable
   */
  on (event, handler) {
    // TODO throw error if event is not one of EVENTS
    // TODO throw error if handler is not a function
    this.dispatcher.on(event, handler)
    return this
  }

  /**
   * Unsubscribe a callback function from a custom event fired by the API.
   * Opposite of {{#crossLink "Editable/on"}}{{/crossLink}}.
   *
   * @param {String} event The name of the event.
   * @param {Function} handler The callback to remove from the
   *     event or the special value false to remove all callbacks.
   *
   * @chainable
   */
  off (...args) {
    this.dispatcher.off.apply(this.dispatcher, args)
    return this
  }

  /**
   * Unsubscribe all callbacks and event listeners.
   *
   * @chainable
   */
  unload () {
    this.dispatcher.unload()
    return this
  }

  /**
   * Takes coordinates and uses its left value to find out how to offset a character in a string to
   * closely match the coordinates.left value.
   * Takes conditions for the result being on the first line, used when navigating to a paragraph from
   * the above paragraph and being on the last line, used when navigating to a paragraph from the below
   * paragraph.
   *
   * Internally this sets up the methods used for a binary cursor search and calls this.
   *
   * @param {DomNode} element
   *  - the editable hostDOM Node to which the cursor jumps
   * @param {object} coordinates
   *  - The bounding rect of the preceeding cursor to be matched
   * @param {boolean} requiredOnFirstLine
   *  - set to true if you want to require the cursor to be on the first line of the paragraph
   * @param {boolean} requiredOnLastLine
   *  - set to true if you want to require the cursor to be on the last line of the paragraph
   *
   * @return {Object}
   *  - object with boolean `wasFound` indicating if the binary search found an offset and `offset` to indicate the actual character offset
   */
  findClosestCursorOffset ({
    element,
    origCoordinates,
    requiredOnFirstLine = false,
    requiredOnLastLine = false
  }) {
    const positionX = this.dispatcher.switchContext
      ? this.dispatcher.switchContext.positionX
      : origCoordinates.left

    return binaryCursorSearch({
      host: element,
      requiredOnFirstLine,
      requiredOnLastLine,
      positionX
    })
  }
}

// Expose modules and editable
Editable.parser = parser
Editable.content = content
Editable.browser = browser

// Set up callback functions for several events.
;['focus', 'blur', 'flow', 'selection', 'cursor', 'newline',
  'insert', 'split', 'merge', 'empty', 'change', 'switch',
  'move', 'clipboard', 'paste', 'spellcheckUpdated', 'selectToBoundary'
].forEach((name) => {
  // Generate a callback function to subscribe to an event.
  Editable.prototype[name] = function (handler) {
    return this.on(name, handler)
  }
})
