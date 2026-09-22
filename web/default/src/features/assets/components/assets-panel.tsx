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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { canUploadAsset, canUseAssetLibrary } from '@/lib/asset-access'
import { formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import {
  createAsset,
  createAssetGroup,
  deleteAsset,
  deleteAssetGroup,
  extractAssetError,
  getAssetCapabilities,
  listAssetGroups,
  listAssets,
  updateAsset,
  updateAssetGroup,
  uploadAsset,
} from '../api'
import { assetStatusVariant } from '../lib/asset-status'
import type { Asset, AssetGroup, AssetListResult, AssetType } from '../types'
import { AssetDetailDialog } from './asset-detail-dialog'

const ASSET_TYPES: AssetType[] = ['Image', 'Video', 'Audio']

/** 素材列表每页条数（与后端默认值一致）。 */
const ASSET_PAGE_SIZE = 20

// 直传允许的扩展名（与后端白名单一致）。
const UPLOAD_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,.bmp,.mp4,.mov,.webm,.mkv,.mp3,.wav,.m4a,.aac,.ogg,.flac'

export function AssetsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [assetDialogOpen, setAssetDialogOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [assetName, setAssetName] = useState('')
  const [assetUrl, setAssetUrl] = useState('')
  const [assetType, setAssetType] = useState<AssetType>('Image')
  const [assetGroupId, setAssetGroupId] = useState<number>(0)
  const [sourceMode, setSourceMode] = useState<'url' | 'file'>('url')
  const [assetFile, setAssetFile] = useState<File | null>(null)
  // 素材组编辑、素材重命名、素材详情、按组筛选与分页。
  const [editingGroup, setEditingGroup] = useState<AssetGroup | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [editingGroupDescription, setEditingGroupDescription] = useState('')
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)
  const [editingAssetName, setEditingAssetName] = useState('')
  const [detailAssetId, setDetailAssetId] = useState(0)
  const [groupFilter, setGroupFilter] = useState(0)
  const [assetPage, setAssetPage] = useState(1)

  const currentUser = useAuthStore((state) => state.auth.user)
  // 两个开关互不依赖：「素材库」决定能否浏览与管理素材，「上传素材」决定能否上传本地文件。
  const canUseLibrary = canUseAssetLibrary(currentUser)
  const canUpload = canUploadAsset(currentUser)

  /** 关闭「新建素材」对话框并清空输入。 */
  const closeAssetDialog = () => {
    setAssetDialogOpen(false)
    setAssetName('')
    setAssetUrl('')
    setAssetFile(null)
    setSourceMode('url')
  }

  const groupsQuery = useQuery({
    queryKey: ['asset-groups'],
    queryFn: listAssetGroups,
    retry: false,
    // 未开通素材功能时列表接口会返回 403，这里直接不发请求。
    enabled: canUseLibrary,
  })
  const assetsQuery = useQuery({
    queryKey: ['assets', groupFilter, assetPage],
    queryFn: () =>
      listAssets({
        groupId: groupFilter,
        page: assetPage,
        pageSize: ASSET_PAGE_SIZE,
      }),
    retry: false,
    enabled: canUseLibrary,
    // 素材入库是异步的，存在处理中的素材时自动轮询状态。
    refetchInterval: (query) => {
      const data = query.state.data as AssetListResult | undefined
      const pending = data?.items.some((item) => item.status === 'PROCESSING')
      return pending ? 5000 : false
    },
  })

  // 能力探测：告诉用户这些模型可以引用素材（不可用时静默跳过）。
  const capabilitiesQuery = useQuery({
    queryKey: ['asset-capabilities'],
    queryFn: getAssetCapabilities,
    retry: false,
    enabled: canUseLibrary,
  })

  const groups = groupsQuery.data ?? []
  const assets = assetsQuery.data?.items ?? []
  const assetTotal = assetsQuery.data?.total ?? 0
  const assetPageCount = Math.max(1, Math.ceil(assetTotal / ASSET_PAGE_SIZE))
  const capabilityModels = (capabilitiesQuery.data?.models ?? []).slice(0, 6)
  const disabledError = extractAssetError(groupsQuery.error ?? assetsQuery.error)
  const notEnabled = disabledError.code === 'asset_library_disabled'

  const createGroupMutation = useMutation({
    mutationFn: createAssetGroup,
    onSuccess: () => {
      toast.success(t('Asset group created'))
      setGroupDialogOpen(false)
      setGroupName('')
      void queryClient.invalidateQueries({ queryKey: ['asset-groups'] })
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  const createAssetMutation = useMutation({
    mutationFn: createAsset,
    onSuccess: () => {
      toast.success(t('Material submitted for ingestion'))
      closeAssetDialog()
      setAssetPage(1)
      void queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  const uploadAssetMutation = useMutation({
    mutationFn: uploadAsset,
    onSuccess: () => {
      toast.success(t('File uploaded and submitted for ingestion'))
      closeAssetDialog()
      void queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (error) => {
      const { message, code } = extractAssetError(error)
      // 地址不可达是本站的部署问题，先给一句用户能看懂的话，再接上给管理员排查用的原始信息。
      if (code === 'asset_public_url_unreachable') {
        toast.error(
          `${t('The upstream cannot read the material from this site. Please contact the administrator.')} ${message}`
        )
        return
      }
      toast.error(message)
    },
  })

  const deleteAssetMutation = useMutation({
    mutationFn: deleteAsset,
    onSuccess: () => {
      toast.success(t('Material deleted'))
      void queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  /** 素材组改名/改描述：空值不提交，后端按「未修改」处理。 */
  const updateGroupMutation = useMutation({
    mutationFn: (payload: { id: number; name: string; description: string }) =>
      updateAssetGroup(payload.id, {
        name: payload.name,
        description: payload.description,
      }),
    onSuccess: () => {
      toast.success(t('Asset group updated'))
      setEditingGroup(null)
      void queryClient.invalidateQueries({ queryKey: ['asset-groups'] })
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  const updateAssetMutation = useMutation({
    mutationFn: (payload: { id: number; name: string }) =>
      updateAsset(payload.id, { name: payload.name }),
    onSuccess: () => {
      toast.success(t('Material updated'))
      setEditingAsset(null)
      void queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  const deleteGroupMutation = useMutation({
    mutationFn: deleteAssetGroup,
    onSuccess: (_result, id) => {
      toast.success(t('Asset group deleted'))
      if (groupFilter === id) setGroupFilter(0)
      void queryClient.invalidateQueries({ queryKey: ['asset-groups'] })
      void queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  if (notEnabled) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('Cloud asset library is not enabled')}</AlertTitle>
        <AlertDescription>
          {t(
            'Please contact the administrator to enable the cloud asset library for this account.'
          )}
        </AlertDescription>
      </Alert>
    )
  }

  // 只开通了「上传素材」：不请求素材列表（会 403），只提供上传入口。
  if (!canUseLibrary) {
    const uploaded = uploadAssetMutation.data
    return (
      <div className='space-y-4'>
        <Alert>
          <AlertTitle>{t('Direct upload')}</AlertTitle>
          <AlertDescription>
            {t(
              'The asset library is not enabled for this account, so materials cannot be browsed or managed here. Uploads still work, and the returned material ID can be referenced as asset://<id> in generation requests.'
            )}
          </AlertDescription>
        </Alert>
        <Card>
          <CardContent className='space-y-4 pt-6'>
            <div className='space-y-1.5'>
              <Label htmlFor='upload-only-name'>{t('Name')}</Label>
              <Input
                id='upload-only-name'
                value={assetName}
                onChange={(event) => setAssetName(event.target.value)}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='upload-only-file'>{t('File')}</Label>
              <Input
                id='upload-only-file'
                type='file'
                accept={UPLOAD_ACCEPT}
                onChange={(event) =>
                  setAssetFile(event.target.files?.[0] ?? null)
                }
              />
              <p className='text-muted-foreground text-xs'>
                {t(
                  'The file is stored on this site only as a temporary copy so the upstream channel can fetch it, and is removed together with the material.'
                )}
              </p>
            </div>
            <Button
              disabled={assetFile === null || uploadAssetMutation.isPending}
              onClick={() => {
                if (assetFile === null) return
                uploadAssetMutation.mutate({
                  file: assetFile,
                  name: assetName.trim() === '' ? assetFile.name : assetName,
                  groupId: 0,
                })
              }}
            >
              {t('Upload')}
            </Button>
            {uploaded && (
              <p className='text-sm'>
                {uploaded.name} · #{uploaded.id} · {uploaded.status}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  const loading = groupsQuery.isLoading || assetsQuery.isLoading

  return (
    <div className='space-y-4'>
      <Alert>
        <AlertTitle>{t('Materials are stored by the upstream channel')}</AlertTitle>
        <AlertDescription>
          {t(
            'Materials are ingested from a public HTTP(S) URL and become usable only after the status turns ACTIVE.'
          )}
          {capabilityModels.length > 0 && (
            <span className='mt-1 block font-mono text-xs'>
              {t('These models support materials')}: {capabilityModels.join('、')}
              {(capabilitiesQuery.data?.models.length ?? 0) >
              capabilityModels.length
                ? '…'
                : ''}
            </span>
          )}
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className='space-y-4 pt-6'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setGroupDialogOpen(true)}
            >
              <Plus className='mr-1 h-4 w-4' />
              {t('New asset group')}
            </Button>
            <Button
              size='sm'
              onClick={() => {
                setAssetGroupId(
                  groupFilter > 0 ? groupFilter : (groups[0]?.id ?? 0)
                )
                setAssetDialogOpen(true)
              }}
            >
              <Plus className='mr-1 h-4 w-4' />
              {t('New material')}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => {
                void groupsQuery.refetch()
                void assetsQuery.refetch()
              }}
            >
              <RefreshCw className='mr-1 h-4 w-4' />
              {t('Refresh')}
            </Button>
          </div>

          {groups.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              {t(
                'No asset group yet. Creating a material will automatically create a default group on the upstream channel.'
              )}
            </p>
          )}

          {groups.length > 0 && (
            <div className='flex flex-wrap gap-2'>
              <button
                type='button'
                className={`rounded-md border px-2 py-1 text-xs ${
                  groupFilter === 0
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50'
                }`}
                onClick={() => {
                  setGroupFilter(0)
                  setAssetPage(1)
                }}
              >
                {t('All')}
              </button>
              {groups.map((group) => (
                <span
                  key={group.id}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                    groupFilter === group.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50'
                  }`}
                >
                  <button
                    type='button'
                    onClick={() => {
                      setGroupFilter(groupFilter === group.id ? 0 : group.id)
                      setAssetPage(1)
                    }}
                  >
                    {group.name} · {group.group_type} · #{group.id}
                  </button>
                  <button
                    type='button'
                    className='hover:text-primary'
                    onClick={() => {
                      setEditingGroup(group)
                      setEditingGroupName(group.name)
                      setEditingGroupDescription(group.description)
                    }}
                    aria-label={t('Edit asset group')}
                  >
                    <Pencil className='h-3.5 w-3.5' />
                  </button>
                  <button
                    type='button'
                    className='hover:text-destructive'
                    onClick={() => deleteGroupMutation.mutate(group.id)}
                    aria-label={t('Delete asset group')}
                  >
                    <Trash2 className='h-3.5 w-3.5' />
                  </button>
                </span>
              ))}
            </div>
          )}

          {loading && (
            <div className='text-muted-foreground flex items-center gap-2 text-sm'>
              <Spinner /> {t('Loading...')}
            </div>
          )}

          {!loading && assets.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              {t('No material yet.')}
            </p>
          )}

          {!loading && assets.length > 0 && (
            <div className='overflow-x-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('ID')}</TableHead>
                    <TableHead>{t('Name')}</TableHead>
                    <TableHead>{t('Type')}</TableHead>
                    <TableHead>{t('Status')}</TableHead>
                    <TableHead>{t('Channel')}</TableHead>
                    <TableHead>{t('Created At')}</TableHead>
                    <TableHead className='text-right'>{t('Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((asset) => (
                    <TableRow key={asset.id}>
                      <TableCell className='font-mono text-xs'>
                        <div className='flex items-center gap-1'>
                          <span>asset://{asset.id}</span>
                          <CopyButton
                            value={`asset://${asset.id}`}
                            size='sm'
                            variant='ghost'
                          />
                        </div>
                      </TableCell>
                      <TableCell className='max-w-[240px] truncate'>
                        <button
                          type='button'
                          className='hover:underline'
                          onClick={() => setDetailAssetId(asset.id)}
                        >
                          {asset.name}
                        </button>
                      </TableCell>
                      <TableCell>{asset.asset_type}</TableCell>
                      <TableCell>
                        <Badge variant={assetStatusVariant(asset.status)}>
                          {asset.status}
                        </Badge>
                        {asset.fail_reason && (
                          <span className='text-destructive ml-2 text-xs'>
                            {asset.fail_reason}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>#{asset.channel_id}</TableCell>
                      <TableCell>
                        {formatTimestampToDate(asset.created_at)}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex justify-end gap-1'>
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => {
                              setEditingAsset(asset)
                              setEditingAssetName(asset.name)
                            }}
                            aria-label={t('Edit material')}
                          >
                            <Pencil className='h-4 w-4' />
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => deleteAssetMutation.mutate(asset.id)}
                            aria-label={t('Delete')}
                          >
                            <Trash2 className='h-4 w-4' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {assetTotal > 0 && (
            <div className='flex items-center justify-end gap-2 text-sm'>
              <span className='text-muted-foreground text-xs'>
                {assetPage} / {assetPageCount} · {assetTotal}
              </span>
              <Button
                size='sm'
                variant='outline'
                disabled={assetPage <= 1}
                onClick={() => setAssetPage((page) => Math.max(1, page - 1))}
              >
                {t('Previous')}
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={assetPage >= assetPageCount}
                onClick={() =>
                  setAssetPage((page) => Math.min(assetPageCount, page + 1))
                }
              >
                {t('Next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AssetDetailDialog
        assetId={detailAssetId}
        onOpenChange={(open) => {
          if (!open) setDetailAssetId(0)
        }}
      />

      <Dialog
        open={editingGroup !== null}
        onOpenChange={(open) => {
          if (!open) setEditingGroup(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Edit asset group')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='asset-group-edit-name'>{t('Name')}</Label>
              <Input
                id='asset-group-edit-name'
                value={editingGroupName}
                onChange={(event) => setEditingGroupName(event.target.value)}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='asset-group-edit-description'>
                {t('Description')}
              </Label>
              <Input
                id='asset-group-edit-description'
                value={editingGroupDescription}
                onChange={(event) =>
                  setEditingGroupDescription(event.target.value)
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditingGroup(null)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={
                editingGroup === null ||
                (editingGroupName.trim() === '' &&
                  editingGroupDescription.trim() === '') ||
                updateGroupMutation.isPending
              }
              onClick={() => {
                if (editingGroup === null) return
                updateGroupMutation.mutate({
                  id: editingGroup.id,
                  name: editingGroupName.trim(),
                  description: editingGroupDescription.trim(),
                })
              }}
            >
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingAsset !== null}
        onOpenChange={(open) => {
          if (!open) setEditingAsset(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Edit material')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-1.5'>
            <Label htmlFor='asset-edit-name'>{t('Name')}</Label>
            <Input
              id='asset-edit-name'
              value={editingAssetName}
              onChange={(event) => setEditingAssetName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditingAsset(null)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={
                editingAsset === null ||
                editingAssetName.trim() === '' ||
                updateAssetMutation.isPending
              }
              onClick={() => {
                if (editingAsset === null) return
                updateAssetMutation.mutate({
                  id: editingAsset.id,
                  name: editingAssetName.trim(),
                })
              }}
            >
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('New asset group')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='asset-group-name'>{t('Name')}</Label>
              <Input
                id='asset-group-name'
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder={t('Virtual portrait group')}
              />
            </div>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Real-person material groups cannot be created here; they are created by the real-person verification flow.'
              )}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setGroupDialogOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={groupName.trim() === '' || createGroupMutation.isPending}
              onClick={() => createGroupMutation.mutate({ name: groupName })}
            >
              {t('Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('New material')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='asset-group'>{t('Asset group')}</Label>
              <NativeSelect
                id='asset-group'
                value={String(assetGroupId)}
                onChange={(event) =>
                  setAssetGroupId(Number(event.target.value))
                }
              >
                <NativeSelectOption value='0'>
                  {t('Default group (created automatically)')}
                </NativeSelectOption>
                {groups.map((group) => (
                  <NativeSelectOption key={group.id} value={String(group.id)}>
                    {group.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='asset-name'>{t('Name')}</Label>
              <Input
                id='asset-name'
                value={assetName}
                onChange={(event) => setAssetName(event.target.value)}
              />
            </div>
            {canUpload && (
              <div className='space-y-1.5'>
                <Label>{t('Source')}</Label>
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    variant={sourceMode === 'url' ? 'default' : 'outline'}
                    onClick={() => setSourceMode('url')}
                  >
                    {t('Public URL')}
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant={sourceMode === 'file' ? 'default' : 'outline'}
                    onClick={() => setSourceMode('file')}
                  >
                    {t('Upload file')}
                  </Button>
                </div>
              </div>
            )}
            {sourceMode === 'url' ? (
              <div className='space-y-1.5'>
                <Label htmlFor='asset-url'>{t('Public URL')}</Label>
                <Input
                  id='asset-url'
                  value={assetUrl}
                  onChange={(event) => setAssetUrl(event.target.value)}
                  placeholder='https://cdn.example.com/portrait.png'
                />
              </div>
            ) : (
              <div className='space-y-1.5'>
                <Label htmlFor='asset-file'>{t('File')}</Label>
                <Input
                  id='asset-file'
                  type='file'
                  accept={UPLOAD_ACCEPT}
                  onChange={(event) =>
                    setAssetFile(event.target.files?.[0] ?? null)
                  }
                />
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'The file is stored on this site only as a temporary copy so the upstream channel can fetch it, and is removed together with the material.'
                  )}
                </p>
              </div>
            )}
            <div className='space-y-1.5'>
              <Label htmlFor='asset-type'>{t('Type')}</Label>
              <NativeSelect
                id='asset-type'
                value={assetType}
                onChange={(event) =>
                  setAssetType(event.target.value as AssetType)
                }
              >
                {ASSET_TYPES.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {type}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={closeAssetDialog}>
              {t('Cancel')}
            </Button>
            {sourceMode === 'url' ? (
              <Button
                disabled={
                  assetName.trim() === '' ||
                  assetUrl.trim() === '' ||
                  createAssetMutation.isPending
                }
                onClick={() =>
                  createAssetMutation.mutate({
                    group_id: assetGroupId,
                    name: assetName,
                    url: assetUrl,
                    asset_type: assetType,
                  })
                }
              >
                {t('Confirm')}
              </Button>
            ) : (
              <Button
                disabled={assetFile === null || uploadAssetMutation.isPending}
                onClick={() => {
                  if (assetFile === null) return
                  const uploadName =
                    assetName.trim() === ''
                      ? (assetFile.name ?? '')
                      : assetName.trim()
                  uploadAssetMutation.mutate({
                    file: assetFile,
                    name: uploadName,
                    groupId: assetGroupId,
                  })
                }}
              >
                {t('Confirm')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
