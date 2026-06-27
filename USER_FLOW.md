# AgroMarketKZ — Карта пользовательских сценариев

Высокоуровневый путь пользователя в приложении (Telegram Mini App / браузер).

```mermaid
flowchart TD
    Start([Пользователь открывает AgroMarketKZ]) --> Reg[Регистрация<br/>сбор контактных данных пользователя]
    Reg --> Menu{{Главное меню}}

    %% Нижняя панель — 3 вкладки
    Menu --> Services[Вкладка «Услуги»]
    Menu --> Goods[Вкладка «Товары»]
    Menu --> General[Вкладка «Общее» / Профиль]

    %% Услуги и товары
    Services --> SCard[Карточка услуги]
    Goods --> GCard[Карточка товара]
    SCard --> Respond{Откликнуться}
    GCard --> Respond

    %% Два варианта при отклике
    Respond -->|Контактные данные| Contacts[Телефон + ссылки:<br/>WhatsApp, Telegram-ник]
    Respond -->|Оставить заявку| Request[Форма заявки:<br/>имя, телефон, комментарий]

    %% Заявку можно оставить и прямо с вкладок
    Services -. Оставить заявку .-> Request
    Goods -. Оставить заявку .-> Request

    Contacts --> Write([Клиент пишет напрямую в WhatsApp / Telegram])
    Request --> Sent([Заявка отправлена])
    Sent --> Admin[[Заявка приходит администратору в Telegram]]

    %% Вкладка «Общее» / Профиль
    General --> MyData[1. Мои контактные данные<br/>+ возможность изменить]
    General --> Fav[2. Избранное]
    General --> Feedback[3. Обратная связь:<br/>почта, WhatsApp, телефон]
    General --> GenReq[4. Оставить заявку]
    GenReq --> Request

    classDef entry fill:#2ecc40,stroke:#1e8a2a,color:#fff,font-weight:bold
    classDef tab fill:#d7ebff,stroke:#3aa0ff,color:#0b3a66,font-weight:bold
    classDef screen fill:#eef7ff,stroke:#3aa0ff,color:#0b3a66
    classDef action fill:#f5e6b3,stroke:#c9a227,color:#5a4a00
    classDef result fill:#ffd966,stroke:#b8860b,color:#4a3b00,font-weight:bold
    classDef seller fill:#dff5e1,stroke:#1e8a2a,color:#14532d

    class Start,Reg entry
    class Services,Goods,General tab
    class Menu,SCard,GCard,Contacts,MyData,Fav,Feedback screen
    class Request,GenReq action
    class Write,Sent result
    class Admin seller
```

## Ключевые моменты для презентации

- **Регистрация на входе** — при первом входе пользователь проходит регистрацию, чтобы платформа собирала контактные данные тех, кто регистрируется.
- **Нижняя панель из 3 вкладок**: «Услуги», «Товары» и «Общее» (профиль).
- **Отклик на товар/услугу даёт 2 варианта**:
  1. **Контактные данные** — телефон + кликабельные ссылки на WhatsApp и Telegram, чтобы клиент сразу написал.
  2. **Оставить заявку** — форма с именем, телефоном и комментарием.
- **Заявку можно оставить из нескольких мест**: с карточки, прямо с вкладок «Услуги»/«Товары» и из раздела «Общее».
- **Вкладка «Общее»** содержит: (1) мои контактные данные с возможностью изменить, (2) избранное, (3) обратную связь (почта, WhatsApp, телефон), (4) оставить заявку.
- **Онлайн-оплаты нет** — заявка приходит администратору в Telegram, дальше связь напрямую.
