/**
 * 本地 Pro 授权信息（本地定制版专用）
 *
 * 「阅读器」本地定制版不依赖 Koodo 官方账号服务：
 * 前端一律视为已登录且已解锁 Pro（见 store/reducers/manager.tsx 的初始 state）。
 * 未登录官方账号时，所有读取用户信息的地方都回落到这里的本地 Pro 用户，
 * 从而彻底关闭赞助 / 购买会员弹窗，同时保留真实账号登录后的数据。
 */
const FAR_FUTURE_TIMESTAMP = 4102444800; // 2100-01-01 00:00:00 UTC

export const localProUserInfo = {
  type: "pro",
  email: "pro@local",
  name: "Pro User",
  nickname: "Pro User",
  valid_until: FAR_FUTURE_TIMESTAMP,
  token_valid_until: FAR_FUTURE_TIMESTAMP,
  time_created: 1700000000,
  free_credits: 999999999,
  tts_credits: 999999999,
  is_enable_koodo_sync: "no",
  default_sync_option: "",
  default_sync_token: "",
};

/**
 * 把任意来源的用户信息强制提升为本地 Pro：
 * 试用 / 免费 / 已过期账号都不会再触发会员校验拦截。
 */
export const ensureProUserInfo = (userInfo: any) => {
  return {
    ...localProUserInfo,
    ...(userInfo || {}),
    type: "pro",
    valid_until: FAR_FUTURE_TIMESTAMP,
    token_valid_until: FAR_FUTURE_TIMESTAMP,
  };
};
