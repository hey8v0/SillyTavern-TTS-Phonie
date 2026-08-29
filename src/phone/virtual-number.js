import { virtualPhoneNumber } from '../core/id.js';

/** 在联系人中按虚拟号码精确匹配。 */
export function findContactByVirtualNumber(contacts, number) {
    const needle = String(number || '').replace(/\s+/g, '');
    if (!needle) return null;
    return (contacts || []).find((contact) => virtualPhoneNumber(contact.id).replace(/\s+/g, '') === needle) || null;
}

export { virtualPhoneNumber };
