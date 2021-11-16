import { Test, TestingModule } from '@nestjs/testing';
import { RulesController } from './rules.controller';
import * as Rules from '../../assets/rules.json';

describe('RulesController', () => {
  let controller: RulesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RulesController],
    }).compile();

    controller = module.get<RulesController>(RulesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return the current rules object', () => {
    expect(controller.getRules()).toEqual(Rules);
  });
});
