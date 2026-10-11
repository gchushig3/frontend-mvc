# Auditoría del taller: SOA + ESB + RabbitMQ + MVC

## Alcance
Este documento revisa la arquitectura y el funcionamiento observado en tres proyectos del taller:

- `soa-productos-service`
- `frontend-mvc`
- `consumidor-eventos`

No se realizaron modificaciones al código fuente; la auditoría se basa en la lectura de la estructura y la lógica actual de cada proyecto.

---

## 1) Resumen ejecutivo

El taller implementa una integración híbrida con tres capas principales:

1. Frontend MVC en NestJS
2. Servicio SOA con SOAP y publicación de eventos
3. Consumidor de eventos con RabbitMQ

La secuencia de negocio es la siguiente:

- El frontend abre la vista principal y, al cargar la página, invoca un servicio SOAP.
- El servicio `soa-productos-service` expone un WSDL y responde con la lista de productos.
- Al responder la consulta, el mismo servicio publica un evento `ProductoConsultado` en RabbitMQ.
- El consumidor `consumidor-eventos` escucha la cola `productos.consultados` y procesa los mensajes.

Esto evidencia una aproximación de SOA + ESB (broker de eventos), donde la operación principal es síncrona por SOAP y la notificación es asíncrona por RabbitMQ.

---

## 2) Auditoría por proyecto

### 2.1 `soa-productos-service`

#### Objetivo funcional
Es el servicio backend responsable de proporcionar productos a través de SOAP, además de publicar un evento cuando se realiza una consulta.

#### Componentes clave
- `index.js`: arranca Express y expone el servicio SOAP.
- `productos.js`: contiene la colección estática de productos.
- `evento-publisher.js`: publica el evento al broker RabbitMQ.
- `productos.wsdl`: contrato WSDL del servicio.

#### Patrones detectados
- Usa Express como servidor HTTP base.
- Usa `soap` para publicar un servicio SOAP con un endpoint `/wsdl`.
- El método `ObtenerProductos` responde con una estructura de tipo:

```js
{ productos: ["id|nombre|precio", ...] }
```

- Antes de responder, invoca `publicarProductoConsultado(PRODUCTOS.length)`.

#### Observaciones técnicas
- El puerto por defecto es `3000`.
- El WSDL define la operación `ObtenerProductos` con entrada vacía y salida con un arreglo de `xsd:string`.
- El servicio reemplaza el valor `http://localhost:3000/wsdl` por una URL configurable vía `SOAP_PUBLIC_URL`.
- La publicación del evento se hace con `amqplib` y una cola llamada `productos.consultados`.

#### Riesgos o limitaciones observadas
- La lista de productos está hardcodeada en memoria; no hay persistencia real.
- La lógica de publicación del evento está acoplada a la operación SOAP.
- Si `AMQP_URL` no está configurado, la publicación falla y se muestra un error.
- No hay manejo robusto de reintentos, dead-letter queue ni monitoreo avanzado.

#### Estado de auditoría
- Funcionalidad central: correcta en la lógica observada.
- Integración con RabbitMQ: presente y activa.
- Perspectiva de producción: requiere configuración y control de errores.

---

### 2.2 `frontend-mvc`

#### Objetivo funcional
Es la capa de presentación, construida con NestJS, que consume el servicio SOAP y renderiza la vista HTML con los productos.

#### Componentes clave
- `src/main.ts`: bootstrap de NestJS con Handlebars (`hbs`).
- `src/app.module.ts`: registro del controlador principal.
- `src/app.controller.ts`: consulta el servicio SOAP y prepara la vista.
- `src/app.service.ts`: tiene un servicio base que no se usa en el flujo principal.
- `views/index.hbs`: plantilla que muestra la lista de productos.

#### Patrón de flujo observado
El controlador principal ejecuta esta lógica:

1. Lee la variable `SOA_SERVICE_URL` o usa un valor por defecto.
2. Crea un cliente SOAP con `soap.createClientAsync`.
3. Llama a `ObtenerProductosAsync({})`.
4. Convierte cada línea del tipo `id|nombre|precio` en un objeto JavaScript.
5. Devuelve el arreglo a la vista.
6. La vista renderiza cada producto en una lista HTML.

#### Observaciones técnicas
- El valor por defecto de `SOA_SERVICE_URL` apunta a una URL externa de Render: `https://soa-productos-service.onrender.com/wsdl`.
- El puerto del frontend por defecto es `3001`.
- La vista usa Handlebars para iterar `{{#each productos}}` y mostrar nombre y precio.
- Se usa `setEndpoint(serviceUrl)` para fijar el endpoint final del cliente SOAP.

#### Riesgos o limitaciones observadas
- Existe una dependencia fuerte de un servicio externo por URL configurable.
- El cliente SOAP no valida el estado del servicio antes de renderizar.
- La vista es muy básica y no maneja estados de error ni loading.
- No hay caché ni manejo de fallos en la respuesta SOAP.

#### Estado de auditoría
- Funcionalidad principal: adecuada para una demostración académica.
- Integración SOA: correcta.
- UX y robustez: mejorable para producción.

---

### 2.3 `consumidor-eventos`

#### Objetivo funcional
Escucha los eventos publicados por el servicio SOA y los procesa desde una cola RabbitMQ.

#### Componentes clave
- `index.js`: establece conexión con RabbitMQ y consume la cola.

#### Patrón de flujo observado
- Lee la variable `AMQP_URL`.
- Conecta a RabbitMQ con `amqplib`.
- Crea un canal y declara la cola `productos.consultados`.
- `channel.consume(...)` recibe cada mensaje.
- Cuando llega un mensaje, lo parsea con `JSON.parse` y lo imprime en consola.
- Realiza `channel.ack(msg)` para confirmar el procesamiento.

#### Observaciones técnicas
- La cola se declara como no durable: `{ durable: false }`.
- El evento tiene esta estructura aproximada:

```json
{
  "eventoId": "uuid",
  "tipo": "ProductoConsultado",
  "fecha": "ISO date",
  "origen": "soa-productos-service",
  "totalProductosDevueltos": 3
}
```

- La aplicación está orientada a logging y observabilidad simple, no a persistencia.

#### Riesgos o limitaciones observadas
- No hay almacenamiento ni historial de eventos.
- La cola no es persistente (`durable: false`), por lo que puede perder mensajes si RabbitMQ reinicia.
- El consumidor no tiene validaciones adicionales ni reintentos.
- No hay separación entre consumo, tratamiento y persistencia.

#### Estado de auditoría
- Funcionalidad de lectura del evento: correcta.
- Preparación para entorno productivo: limitada.

---

## 3) Patrón arquitectónico del taller

### Diagrama conceptual

```text
Frontend MVC (NestJS)
     |
     | SOAP request
     v
soa-productos-service (SOAP)
     |
     | publicacion evento -> RabbitMQ (productos.consultados)
     v
consumidor-eventos
     |
     | logs / procesamiento
     v
Observabilidad simple en consola
```

### Interpretación
El sistema divide responsabilidades de esta manera:

- SOA: exposición de lógica de negocio y datos.
- ESB/RabbitMQ: canal de integración asíncrona para eventos de negocio.
- MVC/NestJS: capa de presentación e interacción con el usuario.

Se trata de una demostración de integración con dos estilos de comunicación:

- Síncrona: SOAP para consultar los productos.
- Asíncrona: mensajes RabbitMQ para notificar que se consultó un conjunto de productos.

---

## 4) Auditoría general del flujo de funcionamiento

### Flujo real observado

1. El usuario accede al frontend en el puerto `3001`.
2. El controlador `AppController` recibe la petición GET a `/`.
3. El controlador ejecuta `soap.createClientAsync(...)` apuntando a la URL del WSDL del servicio SOA.
4. Se invoca `ObtenerProductosAsync({})`.
5. El servicio SOA responde con un arreglo de strings tipo `id|nombre|precio`.
6. El servicio SOA, antes de devolver la respuesta, llama a `publicarProductoConsultado(PRODUCTOS.length)`.
7. Ese método conecta a RabbitMQ usando `AMQP_URL` y publica un mensaje JSON en la cola `productos.consultados`.
8. El consumidor `consumidor-eventos` escucha la cola y, al recibir el evento, lo parsea y lo imprime en consola.
9. El frontend transforma la respuesta SOAP en objetos JavaScript y los pasa a la vista Handlebars.
10. La vista `index.hbs` muestra la lista de productos en la página HTML.

### Resultado funcional
El taller cumple un objetivo didáctico claro: mostrar cómo un frontend puede consumir un servicio SOAP mientras una operación de negocio también genera una notificación asíncrona hacia un broker de eventos.

---

## 5) Fortalezas detectadas

- Separación clara de responsabilidades entre frontend, servicio SOA y consumidor.
- Uso real de protocolo SOAP para integrar sistemas heterogéneos.
- Uso de RabbitMQ para desacoplar generación y consumo de eventos.
- Implementación simple y legible, ideal para aprendizaje o laboratorio.
- La arquitectura permite visualizar un patrón ESB/event-driven con baja complejidad.

## 6) Debilidades y observaciones de calidad

- No hay persistencia de productos ni almacenamiento central.
- No hay manejo de errores ni reintentos en la publicación a RabbitMQ.
- La cola RabbitMQ no es durable, lo cual afecta la tolerancia a fallos.
- El servicio SOAP y el broker comparten la misma dependencia de configuración (`AMQP_URL`).
- El frontend no tiene manejo de fallas si el servicio SOA no responde.
- El proyecto no contiene pruebas automatizadas para validar el flujo end-to-end.

## 7) Recomendaciones de auditoría

1. Definir variables de entorno en `.env` para `PORT`, `SOA_SERVICE_URL` y `AMQP_URL`.
2. Habilitar colas durables y asegurar conexiones reusables en RabbitMQ.
3. Añadir logging estructurado y manejo de errores para cada capa.
4. Incorporar pruebas de integración entre SOAP y RabbitMQ.
5. Evaluar si el consumidor debe persistir eventos o enviar a otra cola de procesamiento.
6. Considerar una capa de seguridad y validación de entrada para servicios expuestos.

---

## 8) Conclusión

El taller evidencia una arquitectura de integración aplicada con criterios académicos: un frontend MVC consume un servicio SOAP y, como efecto secundario de la operación, se envía un evento a RabbitMQ para que otra aplicación lo consuma de forma desacoplada.

Desde el punto de vista de auditoría técnica, el flujo es coherentemente funcional y didácticamente claro, aunque aún requiere reforzar la robustez operativa para un escenario de producción.
