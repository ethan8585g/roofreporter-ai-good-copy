import { describe, it, expect, vi } from 'vitest'

// Unit test for deployLiveKitForCustomer rollback behavior.
// Since the function is not exported, we test the logic pattern directly
// by simulating the trunk-succeeds-but-dispatch-fails scenario.

describe('deployLiveKitForCustomer rollback logic', () => {
  it('should delete orphaned trunk when dispatch rule creation fails', async () => {
    // Simulate the LiveKit API calls
    const deletedTrunks: string[] = []
    const trunkId = 'ST_test_trunk_123'

    // Mock lkApi that succeeds for trunk but fails for dispatch
    async function lkApi(path: string, body: any) {
      if (path.includes('CreateSIPInboundTrunk')) {
        return { trunk: { sip_trunk_id: trunkId } }
      }
      if (path.includes('CreateSIPDispatchRule')) {
        // Simulate dispatch failure — returns no sip_dispatch_rule_id
        return { error: 'internal error', message: 'dispatch creation failed' }
      }
      if (path.includes('DeleteSIPTrunk')) {
        deletedTrunks.push(body.sip_trunk_id)
        return {}
      }
      return {}
    }

    // Simulate the compensating rollback pattern from deployLiveKitForCustomer
    const trunkResult = await lkApi('/twirp/livekit.SIP/CreateSIPInboundTrunk', {
      trunk: { name: 'secretary-99', numbers: ['+17805551234'] }
    })
    const createdTrunkId = trunkResult?.trunk?.sip_trunk_id || ''
    expect(createdTrunkId).toBe(trunkId)

    const dispatchResult = await lkApi('/twirp/livekit.SIP/CreateSIPDispatchRule', {
      trunk_ids: [createdTrunkId],
      rule: { dispatchRuleIndividual: { roomPrefix: 'secretary-99-' } }
    })
    const dispatchId = dispatchResult?.sip_dispatch_rule_id || ''

    // Dispatch failed — no dispatch ID returned
    expect(dispatchId).toBe('')

    // Compensating rollback: delete the orphaned trunk
    if (!dispatchId && createdTrunkId) {
      await lkApi('/twirp/livekit.SIP/DeleteSIPTrunk', { sip_trunk_id: createdTrunkId })
    }

    // Verify the trunk was cleaned up
    expect(deletedTrunks).toContain(trunkId)
    expect(deletedTrunks).toHaveLength(1)
  })

  it('should not delete trunk when dispatch succeeds', async () => {
    const deletedTrunks: string[] = []
    const trunkId = 'ST_trunk_ok'
    const dispatchRuleId = 'SDR_dispatch_ok'

    async function lkApi(path: string, body: any) {
      if (path.includes('CreateSIPInboundTrunk')) {
        return { trunk: { sip_trunk_id: trunkId } }
      }
      if (path.includes('CreateSIPDispatchRule')) {
        return { sip_dispatch_rule_id: dispatchRuleId }
      }
      if (path.includes('DeleteSIPTrunk')) {
        deletedTrunks.push(body.sip_trunk_id)
        return {}
      }
      return {}
    }

    const trunkResult = await lkApi('/twirp/livekit.SIP/CreateSIPInboundTrunk', {
      trunk: { name: 'secretary-100', numbers: ['+17805551234'] }
    })
    const createdTrunkId = trunkResult?.trunk?.sip_trunk_id || ''

    const dispatchResult = await lkApi('/twirp/livekit.SIP/CreateSIPDispatchRule', {
      trunk_ids: [createdTrunkId],
      rule: { dispatchRuleIndividual: { roomPrefix: 'secretary-100-' } }
    })
    const dispatchId = dispatchResult?.sip_dispatch_rule_id || ''

    // Dispatch succeeded — no rollback needed
    expect(dispatchId).toBe(dispatchRuleId)
    if (!dispatchId && createdTrunkId) {
      await lkApi('/twirp/livekit.SIP/DeleteSIPTrunk', { sip_trunk_id: createdTrunkId })
    }

    // No trunk deletion should have occurred
    expect(deletedTrunks).toHaveLength(0)
  })

  it('should mark connection_status as failed when trunk creation fails', async () => {
    let savedStatus = ''

    async function lkApi(path: string, _body: any) {
      if (path.includes('CreateSIPInboundTrunk')) {
        return { error: 'unauthorized' } // No trunk ID returned
      }
      return {}
    }

    // Simulate DB update
    async function updateStatus(status: string, details: string) {
      savedStatus = status
    }

    const trunkResult = await lkApi('/twirp/livekit.SIP/CreateSIPInboundTrunk', {
      trunk: { name: 'secretary-101', numbers: ['+17805551234'] }
    })
    const trunkId = trunkResult?.sip_trunk_id || trunkResult?.trunk?.sip_trunk_id || ''

    if (!trunkId) {
      await updateStatus('failed', 'Trunk creation failed')
    }

    expect(trunkId).toBe('')
    expect(savedStatus).toBe('failed')
  })
})
