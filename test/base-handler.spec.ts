import { createRequest, createResponse } from 'node-mocks-http';
import { TestUploader } from './fixtures/uploader';

describe('BaseHandler', () => {
  let uploader: TestUploader;
  beforeEach(() => (uploader = new TestUploader()));

  it('should implement get()', () => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    expect(uploader.get({ url: '/files/12345' } as any)).resolves.toEqual([]);
  });

  it('should check if storage not ready', () => {
    uploader.storage.isReady = false;
    const res = createResponse();
    uploader.handle(createRequest(), res);
    expect(res.statusCode).toEqual(503);
  });

  it('should check http method', () => {
    const res = createResponse();
    uploader.handle(createRequest({ method: 'TRACE' }), res);
    expect(res.statusCode).toEqual(404);
  });

  describe('sendError', () => {
    beforeEach(() => {
      uploader = new TestUploader();
    });

    it('should send Error (as string)', () => {
      const res = createResponse();
      const sendSpy = jest.spyOn(uploader, 'send');
      const err = new Error('Error Message');
      uploader.sendError(res, err);
      expect(sendSpy).toBeCalledWith({
        res,
        statusCode: 500,
        body: 'Error Message'
      });
    });

    it('should send Error (as json)', () => {
      uploader.responseType = 'json';
      const res = createResponse();
      const sendSpy = jest.spyOn(uploader, 'send');
      const err = new Error('Error Message');
      uploader.sendError(res, err);
      expect(sendSpy).toBeCalledWith({
        res,
        statusCode: 500,
        body: { message: 'Error Message', code: 500, detail: 'Error Message' }
      });
    });
  });

  it.each([
    ['/1/2', '1/2'],
    ['/3', '3'],
    ['/files', 'files'],
    ['/', '']
  ])('express: getName(%p) === %p', (url, name) => {
    expect(uploader.getName(createRequest({ url }))).toBe(name);
  });

  it.each([
    ['/files/1/2', '1/2'],
    ['/files/3', '3'],
    ['/files/files', 'files'],
    ['/', ''],
    ['/1/2', ''],
    ['/3/files/4', '']
  ])('nodejs: getName(%p) === %p', (url, name) => {
    expect(uploader.getName({ url } as any)).toBe(name);
  });
});
