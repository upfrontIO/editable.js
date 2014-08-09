var highlightText = (function() {

  return {
    extractText: function(element) {
      var range = this.getRange(element);
      return range.toString();
    },

    highlight: function(element, regex, stencilElement) {
      var matches = this.find(element, regex);
      this.highlightMatches(element, matches, stencilElement);
    },

    find: function(element, regex) {
      var text = this.extractText(element);
      var match;
      var matches = [];
      var matchIndex = 0;
      while (match = regex.exec(text)) {
        matches.push(this.prepareMatch(match, matchIndex));
        matchIndex += 1;
      }
      return matches;
    },

    highlightMatches: function(element, matches, stencilElement) {
      if (!matches || matches.length == 0) {
        return;
      }

      var textNode, length, firstPortion, lastPortion;
      var currentMatchIndex = 0;
      var currentMatch = matches[currentMatchIndex];
      var totalOffset = 0;
      var iterator = this.getTextIterator(element);
      var portions = [];
      while ( textNode = iterator.getNextTextNode() ) {
        var nodeText = textNode.data;
        var nodeEndOffset = totalOffset + nodeText.length;
        if (nodeEndOffset > currentMatch.startIndex && totalOffset < currentMatch.endIndex) {

          // get portion position
          firstPortion = lastPortion = false;
          if (totalOffset <= currentMatch.startIndex) {
            firstPortion = true;
          }
          if (nodeEndOffset >= currentMatch.endIndex) {
            lastPortion = true;
          }

          // calculate offset and length
          var offset;
          if (firstPortion) {
            offset = currentMatch.startIndex - totalOffset;
          } else {
            offset = 0;
          }

          var length;
          if (lastPortion) {
            length = (currentMatch.endIndex - totalOffset) - offset;
          } else {
            length = textNode.data.length - offset;
          }

          // create portion object
          var portion = {
            element: textNode,
            text: textNode.data.substring(offset, offset + length),
            offset: offset,
            length: length,
            lastPortion: lastPortion
          }

          portions.push(portion);

          if (lastPortion) {
            var lastNode = this.wrapWord(portions, stencilElement);
            iterator.replaceCurrent(lastNode);

            // recalculate nodeEndOffset if we have to replace the current node.
            nodeEndOffset = totalOffset + portion.length + portion.offset;

            portions = [];
            currentMatchIndex += 1;
            if (currentMatchIndex < matches.length) {
              currentMatch = matches[currentMatchIndex];
            }
          }
        }

        totalOffset = nodeEndOffset;
      }
    },

    getRange: function(element) {
      var range = rangy.createRange();
      range.selectNodeContents(element);
      return range;
    },

    getTextIterator: function(element) {
      var iterator = new Iterator(element);
      return iterator;
    },

    // @return the last wrapped element
    wrapWord: function(portions, stencilElement) {
      var element;
      for (var i = 0; i < portions.length; i++) {
        var portion = portions[i];
        element = this.wrapPortion(portion, stencilElement);
      }

      return element;
    },

    wrapPortion: function(portion, stencilElement) {
      var range = rangy.createRange();
      range.setStart(portion.element, portion.offset);
      range.setEnd(portion.element, portion.offset + portion.length);
      var node = stencilElement.cloneNode(true);
      range.surroundContents(node);

      // Fix a weird behaviour where an empty text node is inserted after the range
      if (node.nextSibling) {
        var next = node.nextSibling;
        if (next.nodeType === 3 && next.data === '') {
          next.parentNode.removeChild(next);
        }
      }

      return node;
    },

    prepareMatch: function (match, matchIndex) {
      // Quickfix for the spellcheck regex where we need to match the second subgroup.
      if (match[2]) {
        return this.prepareMatchForSecondSubgroup(match, matchIndex);
      }

      return {
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        matchIndex: matchIndex,
        search: match[0]
      }
    },

    prepareMatchForSecondSubgroup: function (match, matchIndex) {
      var index = match.index;
      index += match[1].length;
      return {
        startIndex: index,
        endIndex: index + match[2].length,
        matchIndex: matchIndex,
        search: match[0]
      }
    }

  }
})();