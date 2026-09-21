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
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { AssetsPanel } from './components/assets-panel'
import { RealPersonPanel } from './components/real-person-panel'

/** 素材库页面：素材管理 + 真人认证两个页签。 */
export function Assets() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Asset Library')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Manage the materials used by video generation: ingest images, videos or audio from a public URL.'
            )}
          </p>
          <Tabs defaultValue='assets' className='gap-3'>
            <TabsList>
              <TabsTrigger value='assets'>{t('Materials')}</TabsTrigger>
              <TabsTrigger value='real-person'>
                {t('Real-person verification')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value='assets'>
              <AssetsPanel />
            </TabsContent>
            <TabsContent value='real-person'>
              <RealPersonPanel />
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
