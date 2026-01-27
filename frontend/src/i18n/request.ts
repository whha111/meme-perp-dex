import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, type Locale } from './config';

export default getRequestConfig(async () => {
  // 从 cookie 或默认值获取语言
  // 由于我们使用客户端存储语言偏好，这里返回默认语言
  // 实际语言切换通过客户端 provider 处理
  const locale: Locale = defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
