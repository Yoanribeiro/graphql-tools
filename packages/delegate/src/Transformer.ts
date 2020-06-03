import { Transform, Request, ExecutionResult } from '@graphql-tools/utils';

import { DelegationContext, Binding } from './types';

import { defaultBinding } from './defaultBinding';

interface Transformation {
  transform: Transform;
  context: Record<string, any>;
}

export class Transformer {
  private transformations: Array<Transformation> = [];
  private delegationContext: DelegationContext;

  constructor(delegationContext: DelegationContext, binding: Binding = defaultBinding) {
    this.delegationContext = delegationContext;
    const delegationTransforms: Array<Transform> = binding(this.delegationContext);
    delegationTransforms.forEach(transform => this.addTransform(transform, {}));
  }

  private addTransform(transform: Transform, context = {}) {
    this.transformations.push({ transform, context });
  }

  public transformRequest(originalRequest: Request) {
    return this.transformations.reduce(
      (request: Request, transformation: Transformation) =>
        transformation.transform.transformRequest != null
          ? transformation.transform.transformRequest(request, transformation.context, this.delegationContext)
          : request,
      originalRequest
    );
  }

  public transformResult(originalResult: ExecutionResult) {
    return this.transformations.reduceRight(
      (result: ExecutionResult, transformation: Transformation) =>
        transformation.transform.transformResult != null
          ? transformation.transform.transformResult(result, transformation.context, this.delegationContext)
          : result,
      originalResult
    );
  }
}
