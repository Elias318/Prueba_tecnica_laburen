# 🤖 Agente Conversacional de Ventas

Este proyecto implementa un **agente conversacional de ventas** que permite a los usuarios explorar productos, crear y gestionar un carrito de compras y derivar la conversación a un agente humano para finalizar la compra o resolver consultas.

El agente está diseñado para ser **directo, verificable y controlado**, utilizando un backend basado en **Cloudflare Workers + D1 (SQLite)**.

---

## 🎯 Objetivo

Guiar al usuario desde la exploración de productos hasta la intención de compra, manteniendo una conversación clara, eficiente y alineada con los datos reales del sistema.

---

## 🧠 Capacidades principales

- 🔍 Explorar productos disponibles
- 📄 Mostrar detalles de productos
- 🛒 Crear un carrito de compras
- ✏️ Editar el carrito (agregar, modificar o eliminar productos)
- 👤 Derivar a un agente humano para cierre de compra o consultas

---

## 🗂️ Modelo de datos (mínimo)

El flujo se soporta con las siguientes tablas:

- **products**: productos disponibles
- **carts**: carrito de compras (uno por conversación)
- **cart_items**: productos y cantidades dentro del carrito

---

## 🔌 Acciones disponibles (Backend)

El agente se comunica con el backend mediante acciones HTTP:

| Acción | Descripción |
|------|-------------|
| `list_products` | Busca productos disponibles |
| `get_product_details` | Obtiene el detalle de un producto |
| `create_cart` | Crea un carrito de compras |
| `update_cart` | Agrega, modifica o elimina productos del carrito |
| `get_cart` | Obtiene el estado actual del carrito |
| `handoff_to_human` | Deriva la conversación a un agente humano |

---

## 🔄 Flujo general

1. El usuario explora productos  
2. Consulta detalles si lo desea  
3. Manifiesta intención de compra  
4. Se crea un carrito  
5. (Opcional) Edita el carrito  
6. Se deriva a un humano para finalizar la compra  

---

## 🛠️ Tecnologías utilizadas

- **Cloudflare Workers**
- **Cloudflare D1 (SQLite)**
- **JavaScript / TypeScript**
- **Mermaid** (documentación de flujos)

---

## 📌 Notas de diseño

- El agente **no inventa información**
- Solo opera sobre datos reales del backend
- El pago y la logística se gestionan siempre por un humano
- Se mantiene un solo carrito por conversación

---

## 📄 Documentación adicional

La documentación conceptual completa (flujo, diagramas y contrato de acciones) se encuentra en la carpeta `/docs`.

---

