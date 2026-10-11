import * as soap from 'soap';
import { AppController } from './app.controller.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AppController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses the configured SOAP endpoint and maps products', async () => {
    const serviceUrl = 'https://soa.example.com/wsdl';
    const client = {
      setEndpoint: vi.fn(),
      ObtenerProductosAsync: vi.fn().mockResolvedValue([
        { productos: ['1|Teclado|25.5'] },
      ]),
    };
    vi.stubEnv('SOA_SERVICE_URL', serviceUrl);
    vi.spyOn(soap, 'createClientAsync').mockResolvedValue(client as never);

    const model = await new AppController().index();

    expect(soap.createClientAsync).toHaveBeenCalledWith(`${serviceUrl}?wsdl`);
    expect(client.setEndpoint).toHaveBeenCalledWith(serviceUrl);
    expect(model).toEqual({ productos: [{ id: '1', nombre: 'Teclado', precio: '25.5' }] });
  });
});
