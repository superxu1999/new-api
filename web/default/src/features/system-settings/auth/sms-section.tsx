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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'

// react-hook-form turns dotted field names (e.g. 'sms.enabled') into nested
// objects, so the schema must be nested too — flat dotted keys never validate.
const smsSchema = z.object({
  sms: z.object({
    enabled: z.boolean(),
    login_enabled: z.boolean(),
    register_enabled: z.boolean(),
    provider: z.string(),
    generic_url: z.string(),
    generic_method: z.string(),
    generic_template: z.string(),
    aliyun_access_key_id: z.string(),
    aliyun_access_secret: z.string(),
    aliyun_sign_name: z.string(),
    aliyun_template_code: z.string(),
    tencent_secret_id: z.string(),
    tencent_secret_key: z.string(),
    tencent_sdk_app_id: z.string(),
    tencent_sign_name: z.string(),
    tencent_template_id: z.string(),
  }),
})

type SmsFormValues = z.infer<typeof smsSchema>

type FlatSmsDefaults = {
  'sms.enabled': boolean
  'sms.login_enabled': boolean
  'sms.register_enabled': boolean
  'sms.provider': string
  'sms.generic_url': string
  'sms.generic_method': string
  'sms.generic_template': string
  'sms.aliyun_access_key_id': string
  'sms.aliyun_access_secret': string
  'sms.aliyun_sign_name': string
  'sms.aliyun_template_code': string
  'sms.tencent_secret_id': string
  'sms.tencent_secret_key': string
  'sms.tencent_sdk_app_id': string
  'sms.tencent_sign_name': string
  'sms.tencent_template_id': string
}

const buildFormDefaults = (defaults: FlatSmsDefaults): SmsFormValues => ({
  sms: {
    enabled: defaults['sms.enabled'],
    login_enabled: defaults['sms.login_enabled'],
    register_enabled: defaults['sms.register_enabled'],
    provider: defaults['sms.provider'] ?? 'disabled',
    generic_url: defaults['sms.generic_url'] ?? '',
    generic_method: defaults['sms.generic_method'] ?? 'POST',
    generic_template: defaults['sms.generic_template'] ?? '',
    aliyun_access_key_id: defaults['sms.aliyun_access_key_id'] ?? '',
    aliyun_access_secret: defaults['sms.aliyun_access_secret'] ?? '',
    aliyun_sign_name: defaults['sms.aliyun_sign_name'] ?? '',
    aliyun_template_code: defaults['sms.aliyun_template_code'] ?? '',
    tencent_secret_id: defaults['sms.tencent_secret_id'] ?? '',
    tencent_secret_key: defaults['sms.tencent_secret_key'] ?? '',
    tencent_sdk_app_id: defaults['sms.tencent_sdk_app_id'] ?? '',
    tencent_sign_name: defaults['sms.tencent_sign_name'] ?? '',
    tencent_template_id: defaults['sms.tencent_template_id'] ?? '',
  },
})

const flattenFormValues = (values: SmsFormValues): FlatSmsDefaults => ({
  'sms.enabled': values.sms.enabled,
  'sms.login_enabled': values.sms.login_enabled,
  'sms.register_enabled': values.sms.register_enabled,
  'sms.provider': values.sms.provider,
  'sms.generic_url': values.sms.generic_url,
  'sms.generic_method': values.sms.generic_method,
  'sms.generic_template': values.sms.generic_template,
  'sms.aliyun_access_key_id': values.sms.aliyun_access_key_id,
  'sms.aliyun_access_secret': values.sms.aliyun_access_secret,
  'sms.aliyun_sign_name': values.sms.aliyun_sign_name,
  'sms.aliyun_template_code': values.sms.aliyun_template_code,
  'sms.tencent_secret_id': values.sms.tencent_secret_id,
  'sms.tencent_secret_key': values.sms.tencent_secret_key,
  'sms.tencent_sdk_app_id': values.sms.tencent_sdk_app_id,
  'sms.tencent_sign_name': values.sms.tencent_sign_name,
  'sms.tencent_template_id': values.sms.tencent_template_id,
})

type SmsSectionProps = {
  defaultValues: FlatSmsDefaults
}

export function SmsSection({ defaultValues }: SmsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const formDefaults = useMemo<SmsFormValues>(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<SmsFormValues>({
    resolver: zodResolver(smsSchema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const selectedProvider = form.watch('sms.provider')
  const isGeneric = selectedProvider === 'generic'
  const isAliyun = selectedProvider === 'aliyun'
  const isTencent = selectedProvider === 'tencent'

  const onSubmit = async (data: SmsFormValues) => {
    const normalized = flattenFormValues(data)
    const updates: Array<{ key: string; value: string | boolean }> = []

    ;(Object.keys(normalized) as Array<keyof FlatSmsDefaults>).forEach(
      (key) => {
        if (String(normalized[key]) !== String(defaultValues[key] ?? '')) {
          updates.push({ key, value: normalized[key] })
        }
      }
    )

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }
  }

  const providerLabel = (value: string) => {
    switch (value) {
      case 'disabled': return t('Disabled')
      case 'generic': return t('Generic HTTP API')
      case 'aliyun': return t('Alibaba Cloud SMS')
      case 'tencent': return t('Tencent Cloud SMS')
      default: return value
    }
  }

  return (
    <SettingsSection title={t('SMS Verification')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          {/* SMS Enabled */}
          <FormField
            control={form.control}
            name='sms.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('SMS Verification')}</FormLabel>
                  <FormDescription>
                    {t('Enable SMS verification for login and registration')}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          {/* SMS Login Enabled */}
          <FormField
            control={form.control}
            name='sms.login_enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('SMS Login')}</FormLabel>
                  <FormDescription>
                    {t('Allow users to log in with phone number and SMS code')}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          {/* SMS Register Enabled */}
          <FormField
            control={form.control}
            name='sms.register_enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('SMS Registration')}</FormLabel>
                  <FormDescription>
                    {t('Allow new users to register with phone number')}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          {/* SMS Provider Selection */}
          <FormField
            control={form.control}
            name='sms.provider'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('SMS Provider')}</FormLabel>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('Select SMS provider')} />
                    </SelectTrigger>
                    <SelectContent>
                      {['disabled', 'generic', 'aliyun', 'tencent'].map((value) => (
                        <SelectItem key={value} value={value}>
                          {providerLabel(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Generic HTTP API Settings */}
          {isGeneric && (
            <>
              <FormField
                control={form.control}
                name='sms.generic_url'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Generic SMS API URL')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='https://api.example.com/sms/send'
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('HTTP endpoint that accepts JSON { phone, code, template }')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='sms.generic_method'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('HTTP Method')}</FormLabel>
                    <FormControl>
                      <Input placeholder='POST' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='sms.generic_template'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Template ID / Name')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('Optional')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {/* Alibaba Cloud SMS Settings */}
          {isAliyun && (
            <>
              <FormField
                control={form.control}
                name='sms.aliyun_access_key_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Access Key ID')}</FormLabel>
                    <FormControl>
                      <Input type='password' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='sms.aliyun_access_secret'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Access Key Secret')}</FormLabel>
                    <FormControl>
                      <Input type='password' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='sms.aliyun_sign_name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('SMS Sign Name')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('e.g. Your Company')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='sms.aliyun_template_code'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('SMS Template Code')}</FormLabel>
                    <FormControl>
                      <Input placeholder='SMS_000000' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {/* Tencent Cloud SMS Settings */}
          {isTencent && (
            <>
              <FormField
                control={form.control}
                name='sms.tencent_secret_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Secret ID')}</FormLabel>
                    <FormControl>
                      <Input type='password' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='sms.tencent_secret_key'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Secret Key')}</FormLabel>
                    <FormControl>
                      <Input type='password' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='sms.tencent_sdk_app_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('SDK App ID')}</FormLabel>
                    <FormControl>
                      <Input placeholder='1400000000' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='sms.tencent_sign_name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('SMS Sign Name')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('e.g. Your Company')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='sms.tencent_template_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('SMS Template ID')}</FormLabel>
                    <FormControl>
                      <Input placeholder='000000' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
