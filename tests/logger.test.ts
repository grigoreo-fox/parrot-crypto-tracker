import { createLogger } from '../src/logger/logger';

describe('logger', () => {
  const clock = () => new Date('2026-11-04T12:00:00.000Z');
  const makeOutput = () => ({
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), log: jest.fn(),
  });

  it('filters debug and trace at info level', () => {
    const output = makeOutput();
    const logger = createLogger('info', output, clock);
    logger.error('error');
    logger.warn('warning');
    logger.info('started', { count: 20 });
    logger.debug('details');
    logger.trace('step');

    expect(output.error).toHaveBeenCalledWith('2026-11-04T12:00:00.000Z ERROR error');
    expect(output.warn).toHaveBeenCalledWith('2026-11-04T12:00:00.000Z WARN warning');
    expect(output.info).toHaveBeenCalledWith('2026-11-04T12:00:00.000Z INFO started', { count: 20 });
    expect(output.debug).not.toHaveBeenCalled();
    expect(output.log).not.toHaveBeenCalled();
  });

  it('includes debug but not trace at debug level', () => {
    const output = makeOutput();
    const logger = createLogger('debug', output, clock);
    logger.debug('details');
    logger.trace('step');
    expect(output.debug).toHaveBeenCalledTimes(1);
    expect(output.log).not.toHaveBeenCalled();
  });

  it('writes trace without a stack trace at trace level', () => {
    const output = makeOutput();
    createLogger('trace', output, clock).trace('step');
    expect(output.log).toHaveBeenCalledWith('2026-11-04T12:00:00.000Z TRACE step');
  });

  it('writes only errors at error level', () => {
    const output = makeOutput();
    const logger = createLogger('error', output, clock);
    logger.error('error');
    logger.warn('warning');
    expect(output.error).toHaveBeenCalledTimes(1);
    expect(output.warn).not.toHaveBeenCalled();
  });
});
