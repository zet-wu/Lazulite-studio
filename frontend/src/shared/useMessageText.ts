import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isMessage, type Message } from '../domain/messages';

/** Keep the event semantic while rendering it in the current language. */
export function useMessageText(initial: string | Message = '') {
  const [value, setValue] = useState<string | Message>(initial);
  const { t } = useTranslation();
  return [isMessage(value) ? t(value.key, value.values ?? {}) : value, setValue] as const;
}
