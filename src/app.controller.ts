import { Controller, Get, Render } from '@nestjs/common';
import * as soap from 'soap';

@Controller()
export class AppController {
  @Get()
  @Render('index')
  async index() {
    const serviceUrl = process.env.SOA_SERVICE_URL || 'https://soa-productos-service.onrender.com/wsdl';
    const client = await soap.createClientAsync(`${serviceUrl}?wsdl`);
    client.setEndpoint(serviceUrl);
    const [result] = await client.ObtenerProductosAsync({});
    const productos = (result.productos || []).map((linea: string) => {
      const [id, nombre, precio] = linea.split('|');
      return { id, nombre, precio };
    });
    return { productos };
  }
}