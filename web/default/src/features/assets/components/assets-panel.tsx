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
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import { formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import {
  createAsset,
  createAssetGroup,
  deleteAsset,
  deleteAssetGroup,
  extractAssetError,
  listAssetGroups,
  listAssets,
  uploadAsset,
} from '../api'
import type { Asset, AssetType } from '../types'

const ASSET_TYPES: AssetType[] = ['Image', 'Video', 'Audio']

// 直传允许的扩展名（与后端白名单一致）。
const UPLOAD_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,.bmp,.mp4,.mov,.webm,.mkv,.mp3,.wav,.m4a,.aac,.ogg,.flac'

/** 状态徽章配色：可用绿、处理中黄、失败红。 */
function statusVariant(status: Asset['status']) {
  if (status === 'ACTIVE') return 'default' as const
  if (status === 'FAILED') return 'destructive' as const
  return 'secondary' as const
}

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

  const currentUser = useAuthStore((state) => state.auth.user)
  // 直传需要管理员开通；管理员本身始终可用。
  const canUpload =
    (currentUser?.role ?? 0) >= 10 || currentUser?.asset_upload_enabled === 1

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
  })
  const assetsQuery = useQuery({
    queryKey: ['assets'],
    queryFn: listAssets,
    retry: false,
    // 素材入库是异步的，存在处理中的素材时自动轮询状态。
    refetchInterval: (query) => {
      const list = query.state.data as Asset[] | undefined
      const pending = list?.some((item) => item.status === 'PROCESSING')
      return pending ? 5000 : false
    },
  })

  const groups = groupsQuery.data ?? []
  const assets = assetsQuery.data ?? []
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
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  const deleteAssetMutation = useMutation({
    mutationFn: deleteAsset,
    onSuccess: () => {
      toast.success(t('Material deleted'))
      void queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  const deleteGroupMutation = useMutation({
    mutationFn: deleteAssetGroup,
    onSuccess: () => {
      toast.success(t('Asset group deleted'))
      void queryClient.invalidateQueries({ queryKey: ['asset-groups'] })
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

  const loading = groupsQuery.isLoading || assetsQuery.isLoading

  return (
    <div className='space-y-4'>
      <Alert>
        <AlertTitle>{t('Materials are stored by the upstream channel')}</AlertTitle>
        <AlertDescription>
          {t(
            'Materials are ingested from a public HTTP(S) URL and become usable only after the status turns ACTIVE.'
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
                setAssetGroupId(groups[0]?.id ?? 0)
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
              {groups.map((group) => (
                <span
                  key={group.id}
                  className='bg-muted/50 flex items-center gap-2 rounded-md border px-2 py-1 text-xs'
                >
                  <span>
                    {group.name} · {group.group_type} · #{group.id}
                  </span>
                  <button
                    type='button'
                    className='text-muted-foreground hover:text-destructive'
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
                        asset://{asset.id}
                      </TableCell>
                      <TableCell className='max-w-[240px] truncate'>
                        {asset.name}
                      </TableCell>
                      <TableCell>{asset.asset_type}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(asset.status)}>
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
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => deleteAssetMutation.mutate(asset.id)}
                        >
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
