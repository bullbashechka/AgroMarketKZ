// Единый источник числовых ограничений для валидации.
// И backend, и webapp берут их отсюда (webapp — для maxLength полей и счётчиков символов).

// Длина текстовых полей
export const NAME_MAX = 100;
export const CARD_TITLE_MAX = 120;
export const CATEGORY_NAME_MAX = 60;
export const DESCRIPTION_MAX = 3000;
export const SPEC_KEY_MAX = 60;
export const SPEC_VALUE_MAX = 300;
export const PRICE_UNIT_MAX = 80;
export const PRICE_REASON_MAX = 500;
export const LOCATION_MAX = 160;
export const AVAILABILITY_MAX = 160;
export const REQUEST_COMMENT_MAX = 1000;
export const FEEDBACK_MESSAGE_MAX = 2000;
export const SEARCH_MAX = 120;

// Прочие поля
export const STORAGE_PATH_MAX = 500;
export const ALT_TEXT_MAX = 200;
export const TELEGRAM_CONTACT_MAX = 100;
export const ADMIN_CHAT_ID_MAX = 64;

// Цена (целое число тенге без копеек, см. PRD раздел 15)
export const PRICE_MIN = 1;
export const PRICE_MAX = 1_000_000_000; // защита от опечаток вроде лишних нулей

// Изображения и характеристики карточки
export const MIN_IMAGES = 1; // минимум одно фото обязательно
export const MAX_IMAGES = 10;
export const MAX_SPECS = 30;

// Пагинация (load-more)
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 50;
