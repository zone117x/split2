/*
Copyright (c) 2014-2021, Matteo Collina <hello@matteocollina.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
*/

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-namespace */

'use strict'

import stream = require('stream')
import type { TransformOptions, TransformCallback } from 'stream'
import string_decoder = require('string_decoder')
const Transform = stream.Transform
const kLast = Symbol('last')
const kDecoder = Symbol('decoder')

namespace split {
  export type Matcher = string | RegExp
  export type Mapper = (line: string) => any
  export interface Options extends TransformOptions {
    maxLength?: number | undefined
    skipOverflow?: boolean
  }
}

interface Split2Transform extends stream.Transform {
  [kLast]: string
  [kDecoder]: string_decoder.StringDecoder
  matcher: split.Matcher
  mapper: split.Mapper
  maxLength: number
  skipOverflow: boolean
  overflow: boolean
}

function transform (this: Split2Transform, chunk: any, enc: BufferEncoding, cb: TransformCallback): void {
  let list
  if (this.overflow) { // Line buffer is full. Skip to start of next line.
    const buf = this[kDecoder].write(chunk)
    list = buf.split(this.matcher)

    if (list.length === 1) return cb() // Line ending not found. Discard entire chunk.

    // Line ending found. Discard trailing fragment of previous line and reset overflow state.
    list.shift()
    this.overflow = false
  } else {
    this[kLast] += this[kDecoder].write(chunk)
    list = this[kLast].split(this.matcher)
  }

  this[kLast] = list.pop() as string

  for (let i = 0; i < list.length; i++) {
    try {
      push(this, this.mapper(list[i]))
    } catch (error: any) {
      return cb(error)
    }
  }

  this.overflow = this[kLast].length > this.maxLength
  if (this.overflow && !this.skipOverflow) {
    cb(new Error('maximum buffer reached'))
    return
  }

  cb()
}

function flush (this: Split2Transform, cb: TransformCallback): void {
  // forward any gibberish left in there
  this[kLast] += this[kDecoder].end()

  if (this[kLast]) {
    try {
      push(this, this.mapper(this[kLast]))
    } catch (error: any) {
      return cb(error)
    }
  }

  cb()
}

function push (self: Split2Transform, val: any): void {
  if (val !== undefined) {
    self.push(val)
  }
}

function noop (incoming: string): any {
  return incoming
}

function split (matcher: split.Matcher, Mapper: split.Mapper, options?: split.Options): stream.Transform
function split (mapper: split.Mapper, options?: split.Options): stream.Transform
function split (matcher: split.Matcher, options?: split.Options): stream.Transform
function split (options?: split.Options): stream.Transform
function split (matcher?: any, mapper?: any, options?: any): stream.Transform {
  // Set defaults for any arguments not supplied.
  matcher = matcher || /\r?\n/
  mapper = mapper || noop
  options = options || {}

  // Test arguments explicitly.
  switch (arguments.length) {
    case 1:
      // If mapper is only argument.
      if (typeof matcher === 'function') {
        mapper = matcher
        matcher = /\r?\n/
      // If options is only argument.
      } else if (typeof matcher === 'object' && !(matcher instanceof RegExp)) {
        options = matcher
        matcher = /\r?\n/
      }
      break

    case 2:
      // If mapper and options are arguments.
      if (typeof matcher === 'function') {
        options = mapper
        mapper = matcher
        matcher = /\r?\n/
      // If matcher and options are arguments.
      } else if (typeof mapper === 'object') {
        options = mapper
        mapper = noop
      }
  }

  options = Object.assign({}, options)
  options.autoDestroy = true
  options.transform = transform
  options.flush = flush
  options.readableObjectMode = true

  const stream = new Transform(options) as Split2Transform

  stream[kLast] = ''
  stream[kDecoder] = new string_decoder.StringDecoder('utf8')
  stream.matcher = matcher
  stream.mapper = mapper
  stream.maxLength = options.maxLength as number
  stream.skipOverflow = options.skipOverflow || false
  stream.overflow = false
  stream._destroy = function (err, cb) {
    // Weird Node v12 bug that we need to work around
    (this as any)._writableState.errorEmitted = false
    cb(err)
  }

  return stream
}

export = split
