# OpenAI API Troubleshooting

## Invalid type for `image_url`

**Ошибка**: `OpenAI 400: Invalid type for 'input[2].content[1].image_url': expected an image URL, but got an object instead.`

**Причина**: поле `image_url` в элементах с `type: "input_image"` должно быть **строкой**, содержащей либо обычный HTTP(S)-URL, либо data-URL с base64-данными. Если передать объект (например, `{ "url": "..." }` или `{ "data": "..." }`), API вернёт ошибку 400.

**Решение**: всегда передавайте строку. Ниже приведены корректные примеры для Responses API и типичные ошибки.

### Примеры корректных запросов

#### Python (официальный SDK)
```python
from openai import OpenAI
client = OpenAI()  # ключ берётся из переменной окружения OPENAI_API_KEY

resp = client.responses.create(
    model="gpt-5",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_image",
                    "image_url": "https://example.com/image.jpg",  # <= СТРОКА!
                    "detail": "auto"  # опционально: "low" | "high" | "auto"
                },
                {
                    "type": "input_text",
                    "text": "Опиши изображение тремя пунктами."
                }
            ]
        }
    ]
)

print(resp.output_text)
```

#### Node.js
```javascript
import OpenAI from "openai";
const openai = new OpenAI(); // использует process.env.OPENAI_API_KEY

const resp = await openai.responses.create({
  model: "gpt-5",
  input: [
    {
      role: "user",
      content: [
        {
          type: "input_image",
          image_url: "https://example.com/image.jpg", // <= только строка
          detail: "auto"
        },
        {
          type: "input_text",
          text: "Что на фото?"
        }
      ]
    }
  ]
});

console.log(resp.output_text);
```

#### Base64 (data-URL)
```python
data_url = "data:image/png;base64,iVBORw0KGgoAAA..."
payload = {
    "model": "gpt-5",
    "input": [
        {
            "role": "user",
            "content": [
                {"type": "input_image", "image_url": data_url},
                {"type": "input_text", "text": "Опиши изображение."}
            ]
        }
    ]
}
```

### Частые ошибки

| Ошибка | Почему | Как нужно |
| --- | --- | --- |
| `"image_url": { "url": "https://..." }` | В поле передан объект. | `"image_url": "https://..."` |
| `"image_url": { "data": "data:image/png;base64,..." }` | В поле передан объект. | `"image_url": "data:image/png;base64,..."` |

Если соблюдать эти правила, запросы к Responses API будут успешно принимать изображения.
