/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { isLoopbackLink } from './real-person-status'

describe('real-person verification link', () => {
  test('treats loopback addresses as unreachable from a phone', () => {
    // 回环地址在手机上指向手机自己，扫码打不开，二维码必须改用上游链接。
    assert.equal(isLoopbackLink('http://localhost:3000/rp/abcdefghij'), true)
    assert.equal(isLoopbackLink('http://127.0.0.1:3099/rp/abcdefghij'), true)
    assert.equal(isLoopbackLink('http://0.0.0.0:3099/rp/abcdefghij'), true)
  })

  test('keeps addresses a phone can reach', () => {
    assert.equal(isLoopbackLink('https://baseadd.vip/rp/abcdefghij'), false)
    assert.equal(isLoopbackLink('https://ghyc.top/rp/abcdefghij'), false)
    // 局域网地址在同一网络下的手机可以打开，不替换成上游链接。
    assert.equal(isLoopbackLink('http://192.168.1.9:3000/rp/abcdefghij'), false)
  })

  test('treats an unparsable link as unreachable', () => {
    assert.equal(isLoopbackLink('not-a-url'), true)
    assert.equal(isLoopbackLink(''), false)
  })
})
