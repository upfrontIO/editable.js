import $ from 'jquery'

import {selectionchange} from './feature-detection'
import * as clipboard from './clipboard'
import eventable from './eventable'
import SelectionWatcher from './selection-watcher'
import config from './config'
import Keyboard from './keyboard'

// This will be set to true once we detect the input event is working.
// Input event description on MDN:
// https://developer.mozilla.org/en-US/docs/Web/Reference/Events/input
let isInputEventSupported = false

/**
 * The Dispatcher module is responsible for dealing with events and their handlers.
 *
 * @module core
 * @submodule dispatcher
 */
export default class Dispatcher {

  constructor (editable) {
    const win = editable.win
    eventable(this, editable)
    this.supportsInputEvent = false
    this.$document = $(win.document)
    this.config = editable.config
    this.editable = editable
    this.editableSelector = editable.editableSelector
    this.selectionWatcher = new SelectionWatcher(this, win)
    this.keyboard = new Keyboard(this.selectionWatcher)
    this.setup()
  }

  /**
  * Sets up all events that Editable.JS is catching.
  *
  * @method setup
  */
  setup () {
    // setup all events listeners and keyboard handlers
    this.setupKeyboardEvents()
    this.setupEventListeners()
  }

  unload () {
    this.off()
    this.$document.off('.editable')
  }

  suspend () {
    if (this.suspended) return
    this.suspended = true
    this.$document.off('.editable')
  }

  continue () {
    if (!this.suspended) return
    this.suspended = false
    this.setupEventListeners()
  }

  setupEventListeners () {
    this.setupElementListeners()
    this.setupKeydownListener()

    if (selectionchange) {
      this.setupSelectionChangeListeners()
    } else {
      this.setupSelectionChangeFallbackListeners()
    }
  }

  /**
  * Sets up events that are triggered on modifying an element.
  *
  * @method setupElementListeners
  */
  setupElementListeners () {
    const self = this
    const selector = this.editableSelector

    this.$document
      .on('focus.editable', selector, function (event) {
        if (this.getAttribute(config.pastingAttribute)) return
        self.selectionWatcher.syncSelection()
        self.notify('focus', this)
      })

      .on('blur.editable', selector, function (event) {
        if (this.getAttribute(config.pastingAttribute)) return
        self.notify('blur', this)
      })

      .on('copy.editable', selector, function (event) {
        const selection = self.selectionWatcher.getFreshSelection()
        if (selection.isSelection) {
          self.notify('clipboard', this, 'copy', selection)
        }
      })

      .on('cut.editable', selector, function (event) {
        const selection = self.selectionWatcher.getFreshSelection()
        if (selection.isSelection) {
          self.notify('clipboard', this, 'cut', selection)
          self.triggerChangeEvent(this)
        }
      })

      .on('paste.editable', selector, function (event) {
        const element = this

        function afterPaste (blocks, cursor) {
          if (blocks.length) {
            self.notify('paste', element, blocks, cursor)

            // The input event does not fire when we process the content manually
            // and insert it via script
            self.notify('change', element)
          } else {
            cursor.setVisibleSelection()
          }
        }

        const cursor = self.selectionWatcher.getFreshSelection()
        clipboard.paste(this, cursor, afterPaste)
      })

      .on('input.editable', selector, function (event) {
        if (isInputEventSupported) {
          self.notify('change', this)
        } else {
          // Most likely the event was already handled manually by
          // triggerChangeEvent so the first time we just switch the
          // isInputEventSupported flag without notifiying the change event.
          isInputEventSupported = true
        }
      })

      .on('formatEditable.editable', selector, function (event) {
        self.notify('change', this)
      })
  }

  /**
  * Trigger a change event
  *
  * This should be done in these cases:
  * - typing a letter
  * - delete (backspace and delete keys)
  * - cut
  * - paste
  * - copy and paste (not easily possible manually as far as I know)
  *
  * Preferrably this is done using the input event. But the input event is not
  * supported on all browsers for contenteditable elements.
  * To make things worse it is not detectable either. So instead of detecting
  * we set 'isInputEventSupported' when the input event fires the first time.
  */
  triggerChangeEvent (target) {
    if (isInputEventSupported) return
    this.notify('change', target)
  }

  dispatchSwitchEvent (event, element, direction) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const cursor = this.selectionWatcher.getFreshSelection()
    if (!cursor || cursor.isSelection) return

    // store position
    if (!this.switchContext) {
      this.switchContext = {
        positionX: cursor.getBoundingClientRect().left,
        events: ['cursor']
      }
    } else {
      this.switchContext.events = ['cursor']
    }

    if (direction === 'up' && cursor.isAtFirstLine()) {
      event.preventDefault()
      event.stopPropagation()
      this.switchContext.events = ['switch', 'blur', 'focus', 'cursor']
      this.notify('switch', element, direction, cursor)
    }

    if (direction === 'down' && cursor.isAtLastLine()) {
      event.preventDefault()
      event.stopPropagation()
      this.switchContext.events = ['switch', 'blur', 'focus', 'cursor']
      this.notify('switch', element, direction, cursor)
    }
  }

  /**
  * Sets up listener for keydown event which forwards events to
  * the Keyboard instance.
  *
  * @method setupKeydownListener
  */
  setupKeydownListener () {
    const self = this

    this.$document.on('keydown.editable', this.editableSelector, function (event) {
      const notifyCharacterEvent = !isInputEventSupported
      self.keyboard.dispatchKeyEvent(event, this, notifyCharacterEvent)
    })
  }

  /**
  * Sets up handlers for the keyboard events.
  * Keyboard definitions are in {{#crossLink "Keyboard"}}{{/crossLink}}.
  *
  * @method setupKeyboardEvents
  */
  setupKeyboardEvents () {
    const self = this

    this.keyboard
      .on('up', function (event) {
        self.dispatchSwitchEvent(event, this, 'up')
      })

      .on('down', function (event) {
        self.dispatchSwitchEvent(event, this, 'down')
      })

      .on('backspace', function (event) {
        const range = self.selectionWatcher.getFreshRange()
        if (!range.isCursor) return self.triggerChangeEvent(this)

        const cursor = range.getCursor()
        if (!cursor.isAtBeginning()) return self.triggerChangeEvent(this)

        event.preventDefault()
        event.stopPropagation()
        self.notify('merge', this, 'before', cursor)
      })

      .on('delete', function (event) {
        const range = self.selectionWatcher.getFreshRange()
        if (!range.isCursor) return self.triggerChangeEvent(this)

        const cursor = range.getCursor()
        if (!cursor.isAtTextEnd()) return self.triggerChangeEvent(this)

        event.preventDefault()
        event.stopPropagation()
        self.notify('merge', this, 'after', cursor)
      })

      .on('enter', function (event) {
        event.preventDefault()
        event.stopPropagation()
        const range = self.selectionWatcher.getFreshRange()
        const cursor = range.forceCursor()

        if (cursor.isAtTextEnd()) {
          self.notify('insert', this, 'after', cursor)
        } else if (cursor.isAtBeginning()) {
          self.notify('insert', this, 'before', cursor)
        } else {
          self.notify('split', this, cursor.before(), cursor.after(), cursor)
        }
      })

      .on('shiftEnter', function (event) {
        event.preventDefault()
        event.stopPropagation()
        const cursor = self.selectionWatcher.forceCursor()
        self.notify('newline', this, cursor)
      })

      .on('bold', function (event) {
        event.preventDefault()
        event.stopPropagation()
        const selection = self.selectionWatcher.getFreshSelection()
        if (selection.isSelection) {
          self.notify('toggleBold', selection)
        }
      })

      .on('italic', function (event) {
        event.preventDefault()
        event.stopPropagation()
        const selection = self.selectionWatcher.getFreshSelection()
        if (selection.isSelection) {
          self.notify('toggleEmphasis', selection)
        }
      })

      .on('character', function (event) {
        self.notify('change', this)
      })
  }

  /**
  * Sets up events that are triggered on a selection change.
  *
  * @method setupSelectionChangeListeners
  * @param {HTMLElement} $document: The document element.
  * @param {Function} notifier: The callback to be triggered when the event is caught.
  */
  setupSelectionChangeListeners () {
    let selectionDirty = false
    let suppressSelectionChanges = false
    const $document = this.$document
    const selectionWatcher = this.selectionWatcher

    // fires on mousemove (thats probably a bit too much)
    // catches changes like 'select all' from context menu
    $document.on('selectionchange.editable', (event) => {
      const cursor = this.selectionWatcher.getFreshSelection()

      if (cursor.isSelection && cursor.isAtBeginning() && cursor.isAtEnd()) {
        this.notify('selectToBoundary', cursor.host, event, 'both', cursor)
      } else if (cursor.isSelection && cursor.isAtBeginning()) {
        this.notify('selectToBoundary', cursor.host, event, 'start', cursor)
      } else if (cursor.isSelection && cursor.isAtEnd()) {
        this.notify('selectToBoundary', cursor.host, event, 'end', cursor)
      }

      if (suppressSelectionChanges) {
        selectionDirty = true
      } else {
        selectionWatcher.selectionChanged()
      }
    })

    // listen for selection changes by mouse so we can
    // suppress the selectionchange event and only fire the
    // change event on mouseup
    $document.on('mousedown.editable', this.editableSelector, (event) => {
      if (this.config.mouseMoveSelectionChanges === false) {
        suppressSelectionChanges = true

        // Without this timeout the previous selection is active
        // until the mouseup event (no. not good).
        setTimeout($.proxy(selectionWatcher, 'selectionChanged'), 0)
      }

      $document.on('mouseup.editableSelection', (evt) => {
        $document.off('.editableSelection')
        suppressSelectionChanges = false

        if (selectionDirty) {
          selectionDirty = false
          selectionWatcher.selectionChanged()
        }
      })
    })
  }

  /**
  * Fallback solution to support selection change events on browsers that don't
  * support selectionChange.
  *
  * @method setupSelectionChangeFallbackListeners
  */
  setupSelectionChangeFallbackListeners () {
    const $document = this.$document
    const selectionWatcher = this.selectionWatcher

    // listen for selection changes by mouse
    $document.on('mouseup.editable', (event) => {
      // In Opera when clicking outside of a block
      // it does not update the selection as it should
      // without the timeout
      setTimeout($.proxy(selectionWatcher, 'selectionChanged'), 0)
    })

    // listen for selection changes by keys
    $document.on('keyup.editable', this.editableSelector, (event) => {
      // when pressing Command + Shift + Left for example the keyup is only triggered
      // after at least two keys are released. Strange. The culprit seems to be the
      // Command key. Do we need a workaround?
      selectionWatcher.selectionChanged()
    })
  }
}
