import { formatMessage } from '../i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isMessage, type Message } from '../domain/messages';

/** Keep the event semantic while rendering it in the current language. */
export function useMessageText(initial: string | Message = '') {
  const [value, setValue] = useState<string | Message>(initial);
  const { t } = useTranslation();
  return [isMessage(value) ? formatMessage(value) : value, setValue] as const;
}
