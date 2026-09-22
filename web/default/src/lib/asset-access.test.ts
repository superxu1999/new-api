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

import { canUploadAsset, canUseAssetLibrary } from './asset-access'

describe('asset access rules', () => {
  test('hides both features from visitors without a session', () => {
    assert.equal(canUseAssetLibrary(null), false)
    assert.equal(canUploadAsset(null), false)
  })

  test('follows the per-account switches for common users', () => {
    const off = { role: 1, asset_library_enabled: 0, asset_upload_enabled: 0 }
    const libraryOnly = {
      role: 1,
      asset_library_enabled: 1,
      asset_upload_enabled: 0,
    }
    const both = { role: 1, asset_library_enabled: 1, asset_upload_enabled: 1 }

    assert.equal(canUseAssetLibrary(off), false)
    assert.equal(canUploadAsset(off), false)
    assert.equal(canUseAssetLibrary(libraryOnly), true)
    assert.equal(canUploadAsset(libraryOnly), false)
    assert.equal(canUseAssetLibrary(both), true)
    assert.equal(canUploadAsset(both), true)
  })

  test('applies the same switches to administrators', () => {
    const adminOff = {
      role: 10,
      asset_library_enabled: 0,
      asset_upload_enabled: 0,
    }
    const adminOn = {
      role: 10,
      asset_library_enabled: 1,
      asset_upload_enabled: 1,
    }
    const rootOff = {
      role: 100,
      asset_library_enabled: 0,
      asset_upload_enabled: 0,
    }

    assert.equal(canUseAssetLibrary(adminOff), false)
    assert.equal(canUploadAsset(adminOff), false)
    assert.equal(canUseAssetLibrary(adminOn), true)
    assert.equal(canUploadAsset(adminOn), true)
    assert.equal(canUseAssetLibrary(rootOff), false)
    assert.equal(canUploadAsset(rootOff), false)
  })

  test('keeps entries visible when a cached session lacks the fields', () => {
    // 升级前写入 localStorage 的会话没有这两个字段，不应因此把入口藏掉。
    assert.equal(canUseAssetLibrary({ role: 1 }), true)
    assert.equal(canUploadAsset({ role: 1 }), true)
  })
})
