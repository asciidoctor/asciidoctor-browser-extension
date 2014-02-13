#!/bin/bash

if [ -z $HIGHLIGHTJS_DIR ]; then
  HIGHLIGHTJS_DIR=.
fi

if [ ! -e "$HIGHLIGHTJS_DIR/tools/build.py" ]; then
  echo 'Cannot find tools/build.py script in highlight.js directory'
  exit 1
fi

if [ -z $PYTHON ]; then
  if [ `python --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1` == '3' ]; then
    PYTHON=python
  else
    PYTHON=python3
  fi
fi

$PYTHON $HIGHLIGHTJS_DIR/tools/build.py java cs cpp objectivec ini diff bash sql php ruby python perl css scss xml javascript coffeescript json markdown asciidoc clojure go haml scala

cp $HIGHLIGHTJS_DIR/build/highlight.pack.js $HIGHLIGHTJS_DIR/build/highlight.min.js
