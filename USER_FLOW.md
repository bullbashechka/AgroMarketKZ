# AgroMarketKZ — Карта пользовательских сценариев

Высокоуровневый путь пользователя в приложении (Telegram Mini App / браузер).

```mermaid
flowchart TD
    Start([Пользователь открывает AgroMarketKZ]) --> Auth[Автоматический вход через Telegram]
    Auth --> Menu{{Главное меню}}

    Menu --> Catalog[Каталог]
    Menu --> Cart[Корзина]
    Menu --> Feedback[Обратная связь / контакты]
    Menu --> Profile[Профиль]

    %% Каталог
    Catalog --> Search[Поиск по названию + фильтры]
    Catalog --> Cats[Категории]
    Search --> Card[Карточка товара / услуги]
    Cats --> Card
    Card --> Gallery[Фото, описание, цена, характеристики]

    %% Два пути к заявке
    Card -->|В корзину| Cart
    Card -->|Оставить заявку| Form[Форма: имя, телефон, комментарий]
    Cart -->|Оформить заказ| Form

    Form --> Phone[Телефон: кнопка Telegram или ввод вручную]
    Phone --> Request([Заявка отправлена])

    %% Что происходит после
    Request --> Seller[[Заявка приходит администратору платформы в Telegram]]
    Seller --> Contact[[Администратор связывается с клиентом]]

    %% Обратная связь
    Feedback --> Contacts[Email, телефон, WhatsApp]
    Feedback --> FbForm[Форма сообщения] --> Seller

    %% Профиль
    Profile --> MyData[Мои контактные данные]
    Profile --> History[История заявок]

    classDef entry fill:#2ecc40,stroke:#1e8a2a,color:#fff,font-weight:bold
    classDef screen fill:#eef7ff,stroke:#3aa0ff,color:#0b3a66
    classDef action fill:#f5e6b3,stroke:#c9a227,color:#5a4a00
    classDef result fill:#ffd966,stroke:#b8860b,color:#4a3b00,font-weight:bold
    classDef seller fill:#dff5e1,stroke:#1e8a2a,color:#14532d

    class Start,Auth entry
    class Menu,Catalog,Cart,Feedback,Profile,Search,Cats,Card,Gallery,Contacts,MyData,History,FbForm screen
    class Form,Phone action
    class Request result
    class Seller,Contact seller
```

## Ключевые моменты для презентации

- **Вход без регистрации** — пользователь сразу в приложении через Telegram.
- **Два пути оставить заявку**: быстро из карточки или через корзину (несколько позиций).
- **Онлайн-оплаты нет** — любое действие превращается в заявку, которую обрабатывает администратор платформы и связывается с клиентом.
- **Заявка мгновенно** приходит администратору платформы в Telegram и сохраняется для учёта.
