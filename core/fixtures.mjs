/**
 * Hand-authored synthetic fixtures for the innovation challenge.
 * None of these amounts, coupons, dates, or store IDs are live McDonald's data.
 */
export const DEMO_NOW = '2026-10-17T12:00:00+08:00';
export const DATA_DISCLAIMER = '合成演示数据，非麦当劳实时价格或官方优惠。计算不创建订单，也不执行支付。';

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

export const catalog = freezeDeep([
  { id: 'spicy-burger', name: '麦辣鸡腿堡', category: '汉堡', priceCents: 2500, emoji: '🍔', tags: ['meat', 'chicken', 'spicy', 'burger', 'spicy-burger'] },
  { id: 'grilled-burger', name: '板烧鸡腿堡', category: '汉堡', priceCents: 2600, emoji: '🍔', tags: ['meat', 'chicken', 'burger', 'grilled-burger'] },
  { id: 'big-mac', name: '巨无霸', category: '汉堡', priceCents: 2900, emoji: '🍔', tags: ['meat', 'beef', 'burger', 'big-mac'] },
  { id: 'nuggets', name: '麦乐鸡（5块）', category: '小食', priceCents: 1300, emoji: '🍗', tags: ['meat', 'chicken', 'nuggets'] },
  { id: 'fries', name: '中薯条', category: '小食', priceCents: 1400, emoji: '🍟', tags: ['fries'] },
  { id: 'cola', name: '中可乐', category: '饮品', priceCents: 1000, emoji: '🥤', tags: ['drink', 'sugary', 'caffeine', 'cola'] },
  { id: 'americano', name: '热美式', category: '饮品', priceCents: 1200, emoji: '☕', tags: ['drink', 'coffee', 'caffeine', 'americano'] },
  { id: 'corn', name: '玉米杯', category: '小食', priceCents: 1200, emoji: '🌽', tags: ['corn'] },
]);

const offer = (data) => ({
  type: 'bundle',
  channels: ['pickup', 'delivery'],
  startsAt: '2026-10-01T00:00:00+08:00',
  expiresAt: '2026-10-31T23:59:59+08:00',
  maxUses: 1,
  requirements: ['合成演示优惠', '每单限用 1 次'],
  ...data,
});

export const demoOffers = freezeDeep([
  offer({
    id: 'demo-spicy-set', title: '麦辣堡薯饮三件套', priceCents: 3300, maxUses: 2,
    items: [{ productId: 'spicy-burger', quantity: 1 }, { productId: 'fries', quantity: 1 }, { productId: 'cola', quantity: 1 }],
    requirements: ['合成演示优惠', '每单限用 2 份', '餐品不可替换'],
  }),
  offer({
    id: 'demo-grilled-set', title: '板烧堡薯饮三件套', priceCents: 3500, maxUses: 2,
    items: [{ productId: 'grilled-burger', quantity: 1 }, { productId: 'fries', quantity: 1 }, { productId: 'cola', quantity: 1 }],
    requirements: ['合成演示优惠', '每单限用 2 份', '餐品不可替换'],
  }),
  offer({
    id: 'demo-burger-duo', title: '双麦辣堡分享券', type: 'coupon', priceCents: 3900,
    items: [{ productId: 'spicy-burger', quantity: 2 }], exclusiveGroup: 'member-choice',
    requirements: ['合成演示优惠', '每单限用 1 次', '与其他会员单选券互斥'],
  }),
  offer({
    id: 'demo-fries-duo', title: '双份中薯券', type: 'coupon', priceCents: 2100,
    items: [{ productId: 'fries', quantity: 2 }], exclusiveGroup: 'member-choice',
    requirements: ['合成演示优惠', '每单限用 1 次', '与其他会员单选券互斥'],
  }),
  offer({
    id: 'demo-nuggets-cola', title: '鸡块可乐搭档', priceCents: 1700, maxUses: 2,
    items: [{ productId: 'nuggets', quantity: 1 }, { productId: 'cola', quantity: 1 }],
    requirements: ['合成演示优惠', '每单限用 2 份'],
  }),
  offer({
    id: 'demo-single-burger', title: '单份麦辣堡会员券', type: 'coupon', priceCents: 1800,
    channels: ['pickup'], items: [{ productId: 'spicy-burger', quantity: 1 }], exclusiveGroup: 'member-choice',
    requirements: ['合成演示优惠', '仅限自取', '每单限用 1 次', '与其他会员单选券互斥'],
  }),
  offer({
    id: 'demo-extra-box', title: '加量四件分享盒', priceCents: 3900,
    items: [{ productId: 'spicy-burger', quantity: 1 }, { productId: 'fries', quantity: 1 }, { productId: 'cola', quantity: 1 }, { productId: 'nuggets', quantity: 1 }],
    requirements: ['合成演示优惠', '每单限用 1 次', '含额外一份麦乐鸡'],
  }),
  offer({
    id: 'demo-coffee-duo', title: '双杯热美式券', type: 'coupon', priceCents: 1600,
    items: [{ productId: 'americano', quantity: 2 }],
  }),
  offer({
    id: 'demo-corn', title: '玉米杯单品券', type: 'coupon', priceCents: 900, maxUses: 2,
    items: [{ productId: 'corn', quantity: 1 }],
    requirements: ['合成演示优惠', '每单限用 2 份'],
  }),
  offer({
    id: 'demo-delivery-set', title: '配送专享三件套', priceCents: 3100, channels: ['delivery'],
    items: [{ productId: 'spicy-burger', quantity: 1 }, { productId: 'fries', quantity: 1 }, { productId: 'cola', quantity: 1 }],
    requirements: ['合成演示优惠', '仅限配送', '不含配送费'],
  }),
  offer({
    id: 'demo-store-set', title: '指定演示门店券', type: 'coupon', priceCents: 2700, channels: ['pickup'],
    items: [{ productId: 'spicy-burger', quantity: 1 }, { productId: 'fries', quantity: 1 }, { productId: 'cola', quantity: 1 }],
    storeIds: ['demo-shanghai-001'],
    requirements: ['合成演示优惠', '仅限指定演示门店 demo-shanghai-001', '仅限自取'],
  }),
  offer({
    id: 'demo-expired-set', title: '已过期三件套券', type: 'coupon', priceCents: 2490,
    items: [{ productId: 'spicy-burger', quantity: 1 }, { productId: 'fries', quantity: 1 }, { productId: 'cola', quantity: 1 }],
    startsAt: '2026-09-01T00:00:00+08:00', expiresAt: '2026-09-30T23:59:59+08:00',
    requirements: ['合成演示优惠', '已于 2026-09-30 过期，不参与计算'],
  }),
]);

export const scenarios = freezeDeep([
  {
    id: 'everyday', title: '一个人，刚刚好', description: '35 元预算，汉堡、薯条、可乐都想要。',
    prompt: '一个人，预算35元，一个麦辣鸡腿堡、一份中薯条和一杯可乐，到店自取，不要凑单。',
    items: [{ productId: 'spicy-burger', quantity: 1 }, { productId: 'fries', quantity: 1 }, { productId: 'cola', quantity: 1 }],
    budgetCents: 3500, people: 1, allowExtras: false, channel: 'pickup',
  },
  {
    id: 'no-upsell', title: '只想吃堡和薯条', description: '少付一块钱，也少买一杯本来就不想喝的可乐。',
    prompt: '一个人，预算35元，一个麦辣鸡腿堡和一份中薯条，只买这些，不凑单，自取。',
    items: [{ productId: 'spicy-burger', quantity: 1 }, { productId: 'fries', quantity: 1 }],
    budgetCents: 3500, people: 1, allowExtras: false, channel: 'pickup',
  },
  {
    id: 'group', title: '三人一起点', description: '先合并真实需求，再组合优惠，最后公平分账。',
    prompt: '三个人，预算80元，两个麦辣鸡腿堡、两份中薯条、两杯可乐和一份麦乐鸡，自取，不多买。',
    items: [{ productId: 'spicy-burger', quantity: 2 }, { productId: 'fries', quantity: 2 }, { productId: 'cola', quantity: 2 }, { productId: 'nuggets', quantity: 1 }],
    budgetCents: 8000, people: 3, allowExtras: false, channel: 'pickup',
  },
]);
